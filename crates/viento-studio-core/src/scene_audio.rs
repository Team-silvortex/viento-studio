//! Bounded engine-independent soundtrack declarations and command-state sampling.
//! No audio decoding, device access, clock, duration guessing or scene mutation.
#![forbid(unsafe_code)]
use crate::CoreError;
use serde::{
    de::{MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use serde_json::{json, Value};
use std::{collections::HashSet, fmt};

fn invalid() -> CoreError {
    CoreError { error_code: "scene_audio_invalid", message: "Expected a complete scene audio manifest with 1–16 tracks, 0–64 cues, and times from zero to 60 seconds." }
}

// Inspect raw bytes recursively before serde_json::Value can erase duplicate
// object keys, including escaped aliases. Semantic errors stay in dispatch.
struct UniqueJson;
impl<'de> Deserialize<'de> for UniqueJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct UniqueVisitor;
        impl<'de> Visitor<'de> for UniqueVisitor {
            type Value = UniqueJson;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("JSON with unique object keys")
            }
            fn visit_bool<E: serde::de::Error>(self, _: bool) -> Result<UniqueJson, E> {
                Ok(UniqueJson)
            }
            fn visit_i64<E: serde::de::Error>(self, _: i64) -> Result<UniqueJson, E> {
                Ok(UniqueJson)
            }
            fn visit_u64<E: serde::de::Error>(self, _: u64) -> Result<UniqueJson, E> {
                Ok(UniqueJson)
            }
            fn visit_f64<E: serde::de::Error>(self, _: f64) -> Result<UniqueJson, E> {
                Ok(UniqueJson)
            }
            fn visit_str<E: serde::de::Error>(self, _: &str) -> Result<UniqueJson, E> {
                Ok(UniqueJson)
            }
            fn visit_unit<E: serde::de::Error>(self) -> Result<UniqueJson, E> {
                Ok(UniqueJson)
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<UniqueJson, A::Error> {
                while seq.next_element::<UniqueJson>()?.is_some() {}
                Ok(UniqueJson)
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<UniqueJson, A::Error> {
                let mut keys = HashSet::new();
                while let Some(key) = map.next_key::<String>()? {
                    if !keys.insert(key) {
                        return Err(serde::de::Error::custom("duplicate JSON key"));
                    }
                    map.next_value::<UniqueJson>()?;
                }
                Ok(UniqueJson)
            }
        }
        deserializer.deserialize_any(UniqueVisitor)
    }
}
pub(crate) fn validate_request_bytes(input: &[u8]) -> Result<(), CoreError> {
    serde_json::from_slice::<UniqueJson>(input)
        .map(|_| ())
        .map_err(|_| CoreError::request())
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
    })
}
fn uuid(value: &Value) -> Result<&str, CoreError> {
    let text = value.as_str().ok_or_else(invalid)?;
    if text.len() != 36
        || !text.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
    {
        return Err(invalid());
    }
    Ok(text)
}
fn bounded_number(value: &Value, max: f64) -> Result<f64, CoreError> {
    let number = value.as_f64().ok_or_else(invalid)?;
    if !number.is_finite() || !(0.0..=max).contains(&number) {
        return Err(invalid());
    }
    Ok(number)
}
fn document(value: &Value) -> Result<Value, CoreError> {
    if !exact(
        value,
        &["format", "schemaVersion", "sceneObjectId", "tracks", "cues"],
    ) || value["format"].as_str() != Some("viento-scene-audio")
        || value["schemaVersion"].as_f64() != Some(1.0)
    {
        return Err(invalid());
    }
    uuid(&value["sceneObjectId"])?;
    let tracks = value["tracks"].as_array().ok_or_else(invalid)?;
    let cues = value["cues"].as_array().ok_or_else(invalid)?;
    if !(1..=16).contains(&tracks.len()) || cues.len() > 64 {
        return Err(invalid());
    }
    let mut track_ids = HashSet::new();
    for track in tracks {
        if !exact(track, &["id", "resourceId", "role", "volume", "loop"])
            || !matches!(track["role"].as_str(), Some("music" | "effect"))
            || !track["loop"].is_boolean()
        {
            return Err(invalid());
        }
        if !track_ids.insert(uuid(&track["id"])?) {
            return Err(invalid());
        }
        uuid(&track["resourceId"])?;
        bounded_number(&track["volume"], 1.0)?;
    }
    let mut cue_ids = HashSet::new();
    for cue in cues {
        if !exact(cue, &["id", "trackId", "atSeconds", "action"])
            || !matches!(cue["action"].as_str(), Some("play" | "stop"))
        {
            return Err(invalid());
        }
        if !cue_ids.insert(uuid(&cue["id"])?) || !track_ids.contains(uuid(&cue["trackId"])?) {
            return Err(invalid());
        }
        bounded_number(&cue["atSeconds"], 60.0)?;
    }
    let mut normalized = value.clone();
    // Stable sorting preserves declared command ordering at the same instant.
    normalized["cues"].as_array_mut().unwrap().sort_by(|a, b| {
        a["atSeconds"]
            .as_f64()
            .unwrap()
            .partial_cmp(&b["atSeconds"].as_f64().unwrap())
            .unwrap()
    });
    Ok(normalized)
}
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum SceneAudioResponse {
    Inspected {
        document: Value,
        diagnostics: Vec<Value>,
    },
    Sampled {
        #[serde(rename = "timeSeconds")]
        time_seconds: f64,
        commands: Vec<Value>,
        states: Vec<Value>,
    },
}
pub(crate) fn dispatch(request: &Value) -> Result<SceneAudioResponse, CoreError> {
    let sample = request["operation"].as_str() == Some("sceneAudio.sample");
    let fields: &[&str] = if sample {
        &["protocolVersion", "operation", "document", "timeSeconds"]
    } else {
        &["protocolVersion", "operation", "document"]
    };
    if !exact(request, fields)
        || request["protocolVersion"].as_f64() != Some(1.0)
        || !sample && request["operation"].as_str() != Some("sceneAudio.inspect")
    {
        return Err(CoreError::request());
    }
    let doc = document(&request["document"])?;
    if !sample {
        return Ok(SceneAudioResponse::Inspected {
            document: doc,
            diagnostics: vec![],
        });
    }
    let time_seconds = bounded_number(&request["timeSeconds"], 60.0)?;
    let tracks = doc["tracks"].as_array().unwrap();
    let mut states: Vec<Value> = tracks.iter().map(|track| json!({"trackId":track["id"],"resourceId":track["resourceId"],"role":track["role"],"volume":track["volume"],"loop":track["loop"],"status":"stopped","startedAtSeconds":null,"lastCueId":null})).collect();
    let mut commands = vec![];
    for cue in doc["cues"].as_array().unwrap() {
        let at = cue["atSeconds"].as_f64().unwrap();
        if at > time_seconds {
            break;
        }
        let index = tracks
            .iter()
            .position(|track| track["id"] == cue["trackId"])
            .unwrap();
        let track = &tracks[index];
        commands.push(json!({"cueId":cue["id"],"trackId":track["id"],"resourceId":track["resourceId"],"atSeconds":cue["atSeconds"],"action":cue["action"],"role":track["role"],"volume":track["volume"],"loop":track["loop"]}));
        let playing = cue["action"].as_str() == Some("play");
        states[index]["status"] = json!(if playing { "playing" } else { "stopped" });
        states[index]["startedAtSeconds"] = if playing {
            cue["atSeconds"].clone()
        } else {
            Value::Null
        };
        states[index]["lastCueId"] = cue["id"].clone();
    }
    Ok(SceneAudioResponse::Sampled {
        time_seconds,
        commands,
        states,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(n: usize) -> String {
        format!("{n:08x}-1111-4111-8111-111111111111")
    }
    fn doc() -> Value {
        json!({"format":"viento-scene-audio","schemaVersion":1,"sceneObjectId":id(1),"tracks":[{"id":id(2),"resourceId":id(3),"role":"music","volume":0.5,"loop":true}],"cues":[{"id":id(4),"trackId":id(2),"atSeconds":0,"action":"play"}]})
    }
    fn request(document: Value, time: Option<f64>) -> Value {
        match time {
            Some(t) => {
                json!({"protocolVersion":1,"operation":"sceneAudio.sample","document":document,"timeSeconds":t})
            }
            None => {
                json!({"protocolVersion":1,"operation":"sceneAudio.inspect","document":document})
            }
        }
    }
    fn run(document: Value, time: Option<f64>) -> Value {
        serde_json::to_value(dispatch(&request(document, time)).unwrap()).unwrap()
    }
    #[test]
    fn inspect_is_detached_and_preserves_track_values() {
        let source = doc();
        let result = run(source.clone(), None);
        assert_eq!(result["document"], source);
        assert_eq!(result["diagnostics"], json!([]));
    }
    #[test]
    fn tracks_without_timeline_cues_remain_unstarted() {
        let mut source = doc();
        source["cues"] = json!([]);
        assert_eq!(run(source.clone(), None)["document"], source);
        for seconds in [0.0, 0.25, 60.0] {
            let sample = run(source.clone(), Some(seconds));
            assert_eq!(sample["commands"], json!([]));
            assert_eq!(sample["states"][0]["status"], "stopped");
            assert_eq!(sample["states"][0]["startedAtSeconds"], Value::Null);
            assert_eq!(sample["states"][0]["lastCueId"], Value::Null);
        }
    }
    #[test]
    fn stable_cues_and_restarts_and_idempotent_stop() {
        let mut d = doc();
        d["cues"] = json!([
            {"id":id(4),"trackId":id(2),"atSeconds":2,"action":"stop"},
            {"id":id(5),"trackId":id(2),"atSeconds":0,"action":"play"},
            {"id":id(6),"trackId":id(2),"atSeconds":2,"action":"play"},
            {"id":id(7),"trackId":id(2),"atSeconds":3,"action":"play"},
            {"id":id(8),"trackId":id(2),"atSeconds":4,"action":"stop"},
            {"id":id(9),"trackId":id(2),"atSeconds":4,"action":"stop"}]);
        let r = run(d.clone(), Some(2.0));
        assert_eq!(
            r["commands"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c["cueId"].clone())
                .collect::<Vec<_>>(),
            vec![json!(id(5)), json!(id(4)), json!(id(6))]
        );
        assert_eq!(r["states"][0]["status"], "playing");
        assert_eq!(r["states"][0]["startedAtSeconds"], 2);
        assert_eq!(
            run(d.clone(), Some(3.0))["states"][0]["startedAtSeconds"],
            3
        );
        let r = run(d, Some(60.0));
        assert_eq!(r["states"][0]["status"], "stopped");
        assert_eq!(r["states"][0]["startedAtSeconds"], Value::Null);
        assert_eq!(r["states"][0]["lastCueId"], id(9));
    }
    #[test]
    fn zero_and_negative_zero_have_the_same_stable_time_order() {
        let mut d = doc();
        d["cues"] = json!([{"id":id(4),"trackId":id(2),"atSeconds":0,"action":"play"},{"id":id(5),"trackId":id(2),"atSeconds":-0.0,"action":"stop"}]);
        let r = run(d, Some(0.0));
        assert_eq!(r["commands"][0]["cueId"], id(4));
        assert_eq!(r["states"][0]["status"], "stopped");
    }
    #[test]
    fn command_state_does_not_guess_natural_completion() {
        let mut d = doc();
        d["tracks"][0]["loop"] = json!(false);
        let r = run(d, Some(60.0));
        assert_eq!(r["states"][0]["status"], "playing");
        assert_eq!(r["states"][0]["startedAtSeconds"], 0);
    }
    #[test]
    fn explicit_sample_is_stateless_and_unstarted_tracks_are_stopped() {
        let mut d = doc();
        d["cues"][0]["atSeconds"] = json!(3);
        let r = run(d.clone(), Some(0.0));
        assert_eq!(r["commands"], json!([]));
        assert_eq!(r["states"][0]["lastCueId"], Value::Null);
        assert_eq!(r["states"][0]["status"], "stopped");
        run(d.clone(), Some(60.0));
        assert_eq!(run(d, Some(0.0)), r);
    }
    #[test]
    fn strict_fields_values_references_and_limits() {
        for path in [
            "/format",
            "/schemaVersion",
            "/sceneObjectId",
            "/tracks/0/id",
            "/tracks/0/resourceId",
            "/tracks/0/role",
            "/tracks/0/volume",
            "/tracks/0/loop",
            "/cues/0/id",
            "/cues/0/trackId",
            "/cues/0/atSeconds",
            "/cues/0/action",
        ] {
            let mut d = doc();
            *d.pointer_mut(path).unwrap() = Value::Null;
            assert!(dispatch(&request(d, None)).is_err(), "{path}");
        }
        for path in ["", "/tracks/0", "/cues/0"] {
            let mut d = doc();
            d.pointer_mut(path).unwrap()["extra"] = json!(true);
            assert!(dispatch(&request(d, None)).is_err());
        }
        for (path, v) in [
            ("/tracks/0/volume", json!(-0.01)),
            ("/tracks/0/volume", json!(1.01)),
            ("/tracks/0/loop", json!(0)),
            ("/tracks/0/role", json!("voice")),
            ("/cues/0/atSeconds", json!(60.01)),
            ("/cues/0/atSeconds", json!(-1)),
            ("/cues/0/action", json!("pause")),
            ("/cues/0/trackId", json!(id(99))),
            (
                "/tracks/0/id",
                json!("ABCDEF00-1111-4111-8111-111111111111"),
            ),
        ] {
            let mut d = doc();
            *d.pointer_mut(path).unwrap() = v;
            assert!(dispatch(&request(d, None)).is_err());
        }
        for name in ["tracks", "cues"] {
            let mut d = doc();
            d[name] = json!([]);
            assert_eq!(dispatch(&request(d, None)).is_err(), name == "tracks");
            let mut d = doc();
            let item = d[name][0].clone();
            d[name].as_array_mut().unwrap().push(item);
            assert!(dispatch(&request(d, None)).is_err());
        }
        let mut d = doc();
        d["tracks"]=(0..16).map(|n|json!({"id":id(2+n),"resourceId":id(50),"role":"effect","volume":if n==0{0}else{1},"loop":false})).collect();
        d["cues"] = (0..64)
            .map(|n| json!({"id":id(100+n),"trackId":id(2+n%16),"atSeconds":60,"action":"play"}))
            .collect();
        assert_eq!(
            run(d.clone(), Some(60.0))["commands"]
                .as_array()
                .unwrap()
                .len(),
            64
        );
        let mut excess = d.clone();
        excess["tracks"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":id(99),"resourceId":id(50),"role":"effect","volume":1,"loop":false}));
        assert!(dispatch(&request(excess, None)).is_err());
        d["cues"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":id(199),"trackId":id(2),"atSeconds":60,"action":"play"}));
        assert!(dispatch(&request(d, None)).is_err());
    }
    #[test]
    fn wire_rejects_nested_and_escaped_duplicates_and_exact_request_fields() {
        let original = request(doc(), None).to_string();
        for (from, to) in [
            (
                "\"protocolVersion\":1",
                "\"protocolVersion\":0,\"protocolVersion\":1",
            ),
            ("\"document\":", "\"document\":null,\"document\":"),
            ("\"volume\":0.5", "\"volume\":1,\"vol\\u0075me\":0.5"),
            (
                "\"action\":\"play\"",
                "\"action\":\"stop\",\"action\":\"play\"",
            ),
        ] {
            let raw = original.replace(from, to);
            let response: Value =
                serde_json::from_slice(&crate::dispatch_json(raw.as_bytes())).unwrap();
            assert_eq!(
                response["errorCode"], "studio_core_request_invalid",
                "{raw}"
            );
        }
        let mut r = request(doc(), None);
        r["timeSeconds"] = json!(0);
        assert!(dispatch(&r).is_err());
        for t in [-1.0, 60.01] {
            assert!(dispatch(&request(doc(), Some(t))).is_err());
        }
    }
}
