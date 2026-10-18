//! Bounded visual animation curves with explicit-time sampling. Scene identity
//! resolution, clocks, rendering, movement and author text stay with the host.
#![forbid(unsafe_code)]
use crate::CoreError;
use serde::{
    de::{MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use serde_json::{json, Value};
use std::{collections::HashSet, fmt};

fn invalid() -> CoreError {
    CoreError { error_code: "scene_animation_invalid", message: "Expected a bounded scene animation with unique visual tracks and strictly increasing keyframes starting at zero." }
}

// Check decoded keys before Value can erase duplicate fields or escaped aliases.
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
    value
        .as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|key| o.contains_key(*key)))
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
fn number(value: &Value, min: f64, max: f64) -> Result<f64, CoreError> {
    let n = value.as_f64().ok_or_else(invalid)?;
    if !n.is_finite() || !(min..=max).contains(&n) {
        return Err(invalid());
    }
    Ok(n)
}
fn visual_value(value: &Value, property: &str) -> Result<(), CoreError> {
    match property {
        "offset2d" | "scale2d" => {
            let values = value.as_array().ok_or_else(invalid)?;
            if values.len() != 2 {
                return Err(invalid());
            }
            let (min, max) = if property == "offset2d" {
                (-10000.0, 10000.0)
            } else {
                (0.01, 100.0)
            };
            for value in values {
                number(value, min, max)?;
            }
        }
        "rotation2d" => {
            number(value, -36000.0, 36000.0)?;
        }
        "opacity" => {
            number(value, 0.0, 1.0)?;
        }
        _ => return Err(invalid()),
    }
    Ok(())
}
fn validate_document(value: &Value) -> Result<(), CoreError> {
    if !exact(
        value,
        &[
            "format",
            "schemaVersion",
            "sceneObjectId",
            "durationSeconds",
            "loop",
            "tracks",
        ],
    ) || value["format"] != "viento-scene-animation"
        || value["schemaVersion"].as_f64() != Some(1.0)
        || !value["loop"].is_boolean()
    {
        return Err(invalid());
    }
    uuid(&value["sceneObjectId"])?;
    let duration = number(&value["durationSeconds"], 0.0, 60.0)?;
    if duration == 0.0 {
        return Err(invalid());
    }
    let tracks = value["tracks"].as_array().ok_or_else(invalid)?;
    if !(1..=32).contains(&tracks.len()) {
        return Err(invalid());
    }
    let mut ids = HashSet::new();
    let mut channels = HashSet::new();
    let mut count = 0;
    for track in tracks {
        if !exact(
            track,
            &["id", "instanceId", "property", "interpolation", "keyframes"],
        ) || !matches!(track["interpolation"].as_str(), Some("linear" | "step"))
        {
            return Err(invalid());
        }
        if !ids.insert(uuid(&track["id"])?) {
            return Err(invalid());
        }
        let instance = uuid(&track["instanceId"])?;
        let property = track["property"].as_str().ok_or_else(invalid)?;
        if !channels.insert((instance, property)) {
            return Err(invalid());
        }
        let keys = track["keyframes"].as_array().ok_or_else(invalid)?;
        count += keys.len();
        if !(1..=64).contains(&keys.len()) || count > 512 {
            return Err(invalid());
        }
        let mut previous = None;
        for key in keys {
            if !exact(key, &["atSeconds", "value"]) {
                return Err(invalid());
            }
            let at = number(&key["atSeconds"], 0.0, duration)?;
            if previous.map_or(at != 0.0, |p| at <= p) {
                return Err(invalid());
            }
            previous = Some(at);
            visual_value(&key["value"], property)?;
        }
    }
    // The author transport also bounds original text bytes (including whitespace).
    if serde_json::to_vec(value).map_err(|_| invalid())?.len() > 65536 {
        return Err(invalid());
    }
    Ok(())
}
fn interpolate(left: &Value, right: &Value, weight: f64) -> Value {
    let scalar = |a: f64, b: f64| (a + (b - a) * weight).clamp(a.min(b), a.max(b));
    if let Some(a) = left.as_array() {
        let b = right.as_array().unwrap();
        json!([
            scalar(a[0].as_f64().unwrap(), b[0].as_f64().unwrap()),
            scalar(a[1].as_f64().unwrap(), b[1].as_f64().unwrap())
        ])
    } else {
        json!(scalar(left.as_f64().unwrap(), right.as_f64().unwrap()))
    }
}
fn sample_track(track: &Value, time: f64) -> Value {
    let keys = track["keyframes"].as_array().unwrap();
    // The schema guarantees a zero key, so every nonnegative time has a left key.
    let index = keys.partition_point(|key| key["atSeconds"].as_f64().unwrap() <= time) - 1;
    let left = &keys[index];
    if track["interpolation"] == "step"
        || index + 1 == keys.len()
        || left["atSeconds"].as_f64().unwrap() == time
    {
        return left["value"].clone();
    }
    let right = &keys[index + 1];
    let start = left["atSeconds"].as_f64().unwrap();
    let weight = (time - start) / (right["atSeconds"].as_f64().unwrap() - start);
    interpolate(&left["value"], &right["value"], weight)
}
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum SceneAnimationResponse {
    Inspected {
        document: Value,
    },
    Sampled {
        #[serde(rename = "timeSeconds")]
        time_seconds: f64,
        #[serde(rename = "localTimeSeconds")]
        local_time_seconds: f64,
        finished: bool,
        values: Vec<Value>,
    },
}
pub(crate) fn dispatch(request: &Value) -> Result<SceneAnimationResponse, CoreError> {
    let sample = request["operation"].as_str() == Some("sceneAnimation.sample");
    let fields: &[&str] = if sample {
        &["protocolVersion", "operation", "document", "timeSeconds"]
    } else {
        &["protocolVersion", "operation", "document"]
    };
    if !exact(request, fields)
        || request["protocolVersion"].as_f64() != Some(1.0)
        || !sample && request["operation"] != "sceneAnimation.inspect"
    {
        return Err(CoreError::request());
    }
    let document = &request["document"];
    validate_document(document)?;
    if !sample {
        return Ok(SceneAnimationResponse::Inspected {
            document: document.clone(),
        });
    }
    let time_seconds = number(&request["timeSeconds"], 0.0, 86400.0)?;
    let duration = document["durationSeconds"].as_f64().unwrap();
    let looping = document["loop"].as_bool().unwrap();
    let local_time_seconds = if looping {
        time_seconds % duration
    } else {
        time_seconds.min(duration)
    };
    let values = document["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|track| {
            json!({
                "trackId":track["id"],"instanceId":track["instanceId"],"property":track["property"],
                "value":sample_track(track, local_time_seconds)
            })
        })
        .collect();
    Ok(SceneAnimationResponse::Sampled {
        time_seconds,
        local_time_seconds,
        finished: !looping && time_seconds >= duration,
        values,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(n: usize) -> String {
        format!("{n:08x}-1111-4111-8111-111111111111")
    }
    fn doc() -> Value {
        json!({"format":"viento-scene-animation","schemaVersion":1,"sceneObjectId":id(1),"durationSeconds":2,"loop":false,"tracks":[{
            "id":id(2),"instanceId":id(3),"property":"offset2d","interpolation":"linear","keyframes":[{"atSeconds":0,"value":[0,10]},{"atSeconds":1,"value":[20,-10]}]
        }]})
    }
    fn request(document: Value, time: Option<f64>) -> Value {
        match time {
            Some(t) => {
                json!({"protocolVersion":1,"operation":"sceneAnimation.sample","document":document,"timeSeconds":t})
            }
            None => {
                json!({"protocolVersion":1,"operation":"sceneAnimation.inspect","document":document})
            }
        }
    }
    fn run(document: Value, time: Option<f64>) -> Value {
        serde_json::to_value(dispatch(&request(document, time)).unwrap()).unwrap()
    }
    #[test]
    fn detached_inspection_and_explicit_time_sampling_preserve_author_data() {
        let document = doc();
        assert_eq!(run(document.clone(), None), json!({"document":document}));
        let half = run(document.clone(), Some(0.5));
        assert_eq!(half["values"][0]["value"], json!([10.0, 0.0]));
        assert_eq!(half["finished"], false);
        run(document.clone(), Some(86400.0));
        assert_eq!(run(document, Some(0.5)), half);
    }
    #[test]
    fn terminal_hold_and_loop_boundaries_have_explicit_semantics() {
        let document = doc();
        for t in [1.0, 1.5, 2.0, 86400.0] {
            let value = run(document.clone(), Some(t));
            assert_eq!(value["values"][0]["value"], json!([20, -10]));
            assert_eq!(value["finished"], t >= 2.0);
            assert_eq!(value["localTimeSeconds"], json!(t.min(2.0)));
        }
        let mut looping = document;
        looping["loop"] = json!(true);
        for t in [0.0, 2.0, 4.0, 86400.0] {
            let value = run(looping.clone(), Some(t));
            assert_eq!(value["localTimeSeconds"], 0.0);
            assert_eq!(value["finished"], false);
            assert_eq!(value["values"][0]["value"], json!([0, 10]));
        }
    }
    #[test]
    fn step_is_right_continuous_and_all_visual_properties_sample() {
        let mut document = doc();
        document["tracks"][0]["interpolation"] = json!("step");
        assert_eq!(
            run(document.clone(), Some(0.999))["values"][0]["value"],
            json!([0, 10])
        );
        assert_eq!(
            run(document.clone(), Some(1.0))["values"][0]["value"],
            json!([20, -10])
        );
        for (property, a, b, expected) in [
            ("rotation2d", json!(-360.0), json!(360.0), json!(0.0)),
            (
                "scale2d",
                json!([0.01, 100.0]),
                json!([100.0, 0.01]),
                json!([50.005, 50.005]),
            ),
            ("opacity", json!(0.0), json!(1.0), json!(0.5)),
        ] {
            document["tracks"][0]["property"] = json!(property);
            document["tracks"][0]["interpolation"] = json!("linear");
            document["tracks"][0]["keyframes"] =
                json!([{"atSeconds":0,"value":a},{"atSeconds":1,"value":b}]);
            let actual = run(document.clone(), Some(0.5))["values"][0]["value"].clone();
            if property == "scale2d" {
                for n in actual.as_array().unwrap() {
                    assert!((n.as_f64().unwrap() - 50.005).abs() < 1e-12);
                }
            } else {
                assert_eq!(actual, expected);
            }
        }
    }
    #[test]
    fn scalar_and_vector_shapes_bounds_and_exact_fields_are_required() {
        let mut values = vec![];
        for path in [
            "/format",
            "/schemaVersion",
            "/sceneObjectId",
            "/durationSeconds",
            "/loop",
            "/tracks/0/id",
            "/tracks/0/instanceId",
            "/tracks/0/property",
            "/tracks/0/interpolation",
            "/tracks/0/keyframes/0/atSeconds",
            "/tracks/0/keyframes/0/value",
        ] {
            let mut value = doc();
            *value.pointer_mut(path).unwrap() = Value::Null;
            values.push(value);
        }
        for value in [
            json!([]),
            json!([0]),
            json!([0, 0, 0]),
            json!([10000.001, 0]),
            json!([-10000.001, 0]),
            json!(["0", 0]),
            json!(0),
        ] {
            let mut document = doc();
            document["tracks"][0]["keyframes"][0]["value"] = value;
            values.push(document);
        }
        for duration in [0.0, -0.0, -1.0, 60.001] {
            let mut value = doc();
            value["durationSeconds"] = json!(duration);
            values.push(value);
        }
        for path in ["", "/tracks/0", "/tracks/0/keyframes/0"] {
            let mut value = doc();
            value
                .pointer_mut(path)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert("extra".into(), json!(true));
            values.push(value);
        }
        for value in values {
            assert!(dispatch(&request(value, None)).is_err());
        }
        for seconds in [-1.0, 86400.001] {
            assert!(dispatch(&request(doc(), Some(seconds))).is_err());
        }
    }
    #[test]
    fn unique_tracks_channels_and_ordered_zero_based_keys_are_required() {
        let mut value = doc();
        let duplicate = value["tracks"][0].clone();
        value["tracks"].as_array_mut().unwrap().push(duplicate);
        assert!(validate_document(&value).is_err());
        value["tracks"][1]["id"] = json!(id(4));
        assert!(validate_document(&value).is_err());
        value["tracks"][1]["instanceId"] = json!(id(5));
        assert!(validate_document(&value).is_ok());
        for times in [[0.1, 1.0], [0.0, 0.0], [0.0, 2.1]] {
            let mut value = doc();
            for (i, t) in times.iter().enumerate() {
                value["tracks"][0]["keyframes"][i]["atSeconds"] = json!(t);
            }
            assert!(validate_document(&value).is_err());
        }
        let mut value = doc();
        value["tracks"][0]["keyframes"] = json!([{"atSeconds":0,"value":[1,2]}]);
        assert_eq!(
            run(value, Some(86400.0))["values"][0]["value"],
            json!([1, 2])
        );
    }
    #[test]
    fn global_and_per_track_key_budgets_are_independent() {
        let mut document = doc();
        let base = document["tracks"][0].clone();
        document["tracks"] = json!((0..8)
            .map(|i| {
                let mut track = base.clone();
                track["id"] = json!(id(10 + i));
                track["instanceId"] = json!(id(100 + i));
                track["keyframes"] = json!((0..64)
                    .map(|j| json!({"atSeconds":j as f64/64.0,"value":[0,0]}))
                    .collect::<Vec<_>>());
                track
            })
            .collect::<Vec<_>>());
        assert!(validate_document(&document).is_ok());
        let mut extra = base.clone();
        extra["id"] = json!(id(999));
        extra["instanceId"] = json!(id(998));
        document["tracks"].as_array_mut().unwrap().push(extra);
        assert!(validate_document(&document).is_err());
        let mut document = doc();
        document["tracks"][0]["keyframes"] = json!((0..65)
            .map(|j| json!({"atSeconds":j as f64/64.0,"value":[0,0]}))
            .collect::<Vec<_>>());
        assert!(validate_document(&document).is_err());
    }
    #[test]
    fn raw_duplicate_escaped_keys_bom_and_unpaired_unicode_fail_closed() {
        let raw = serde_json::to_string(&request(doc(), None)).unwrap();
        for (from, to) in [
            ("\"loop\":false", "\"loop\":true,\"lo\\u006fp\":false"),
            (
                "\"protocolVersion\":1",
                "\"protocolVersion\":0,\"protocolVersion\":1",
            ),
            ("\"atSeconds\":0", "\"atSeconds\":1,\"atSeconds\":0"),
        ] {
            let wire = raw.replace(from, to);
            assert_eq!(
                serde_json::to_value(crate::dispatch(wire.as_bytes())).unwrap()["errorCode"],
                "studio_core_request_invalid"
            );
        }
        for wire in [format!("\u{feff}{raw}"), raw.replace(&id(1), "\\uD800")] {
            assert_eq!(
                serde_json::to_value(crate::dispatch(wire.as_bytes())).unwrap()["errorCode"],
                "studio_core_request_invalid"
            );
        }
    }
}
