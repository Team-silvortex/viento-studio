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
fn integer(value: &Value, min: f64, max: f64) -> Result<f64, CoreError> {
    let value = number(value, min, max)?;
    if value.fract() != 0.0 {
        return Err(invalid());
    }
    Ok(value)
}
fn sprite_frame_count(track: &Value) -> Result<f64, CoreError> {
    let grid = &track["grid"];
    if !exact(grid, &["columns", "rows"]) || track["interpolation"] != "step" {
        return Err(invalid());
    }
    let columns = integer(&grid["columns"], 1.0, 64.0)?;
    let rows = integer(&grid["rows"], 1.0, 64.0)?;
    Ok(columns * rows)
}
fn visual_value(value: &Value, property: &str, frame_count: Option<f64>) -> Result<(), CoreError> {
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
        "spriteFrame2d" => {
            integer(value, 0.0, frame_count.ok_or_else(invalid)? - 1.0)?;
        }
        _ => return Err(invalid()),
    }
    Ok(())
}
// Use the same whitespace set as ECMAScript trim in the strict JS receipt gate.
fn label_space(ch: char) -> bool {
    matches!(ch, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
fn validate_document(value: &Value) -> Result<(), CoreError> {
    let clips = value["schemaVersion"].as_f64() == Some(3.0);
    let fields: &[&str] = if clips {
        &[
            "format",
            "schemaVersion",
            "sceneObjectId",
            "durationSeconds",
            "loop",
            "tracks",
            "clips",
        ]
    } else {
        &[
            "format",
            "schemaVersion",
            "sceneObjectId",
            "durationSeconds",
            "loop",
            "tracks",
        ]
    };
    if !exact(value, fields)
        || value["format"] != "viento-scene-animation"
        || !matches!(value["schemaVersion"].as_f64(), Some(1.0 | 2.0 | 3.0))
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
        let sprite = track["property"] == "spriteFrame2d";
        let fields: &[&str] = if sprite {
            &[
                "id",
                "instanceId",
                "property",
                "interpolation",
                "keyframes",
                "grid",
            ]
        } else {
            &["id", "instanceId", "property", "interpolation", "keyframes"]
        };
        if !exact(track, fields)
            || sprite && value["schemaVersion"].as_f64() == Some(1.0)
            || !matches!(track["interpolation"].as_str(), Some("linear" | "step"))
        {
            return Err(invalid());
        }
        if !ids.insert(uuid(&track["id"])?) {
            return Err(invalid());
        }
        let instance = uuid(&track["instanceId"])?;
        let property = track["property"].as_str().ok_or_else(invalid)?;
        let frame_count = if sprite {
            Some(sprite_frame_count(track)?)
        } else {
            None
        };
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
            visual_value(&key["value"], property, frame_count)?;
        }
    }
    if clips {
        let clips = value["clips"].as_array().ok_or_else(invalid)?;
        if clips.len() > 32 {
            return Err(invalid());
        }
        let mut ids = HashSet::new();
        for clip in clips {
            if !exact(clip, &["id", "name", "startSeconds", "endSeconds", "loop"])
                || !clip["loop"].is_boolean()
                || !ids.insert(uuid(&clip["id"])?)
            {
                return Err(invalid());
            }
            let name = clip["name"].as_str().ok_or_else(invalid)?;
            if name.is_empty()
                || name.trim_matches(label_space) != name
                || name.chars().count() > 128
                || name.chars().any(|ch| ch <= '\u{001f}' || ch == '\u{007f}')
            {
                return Err(invalid());
            }
            let start = number(&clip["startSeconds"], 0.0, duration)?;
            let end = number(&clip["endSeconds"], 0.0, duration)?;
            if start >= end {
                return Err(invalid());
            }
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
// A transport receipt belongs to one scene and one monotonically increasing
// host clock. The host additionally binds the manifest revision and visit; no
// native state, timer, rendering object or author mutation is retained here.
fn transport(
    document: &Value,
    state: &Value,
    time: &Value,
    command: &Value,
) -> Result<SceneAnimationResponse, CoreError> {
    const MAX_TIME: f64 = 9007199254740991.0;
    let duration = document["durationSeconds"].as_f64().unwrap();
    let looping = document["loop"].as_bool().unwrap();
    let time_seconds = number(time, 0.0, MAX_TIME)?;
    let (mut phase, mut position, previous_time) = if state.is_null() {
        ("playing", 0.0, 0.0)
    } else {
        if !exact(
            state,
            &["sceneObjectId", "phase", "positionSeconds", "timeSeconds"],
        ) || state["sceneObjectId"] != document["sceneObjectId"]
        {
            return Err(invalid());
        }
        let phase = state["phase"].as_str().ok_or_else(invalid)?;
        let position = number(&state["positionSeconds"], 0.0, duration)?;
        let clock = number(&state["timeSeconds"], 0.0, MAX_TIME)?;
        if !matches!(phase, "playing" | "paused" | "stopped" | "finished")
            || looping && position == duration
            || phase == "playing" && position == duration
            || phase == "stopped" && position != 0.0
            || phase == "finished" && (looping || position != duration)
        {
            return Err(invalid());
        }
        (phase, position, clock)
    };
    if time_seconds < previous_time {
        return Err(invalid());
    }
    let action = if command.is_null() {
        None
    } else {
        let action = command["action"].as_str().ok_or_else(invalid)?;
        if !exact(
            command,
            if action == "seek" {
                &["action", "positionSeconds"]
            } else {
                &["action"]
            },
        ) || !matches!(action, "play" | "pause" | "stop" | "seek")
        {
            return Err(invalid());
        }
        Some(action)
    };
    // Reduce elapsed loop time before addition so a long-running host clock
    // cannot round away the small retained playback position.
    if phase == "playing" {
        let elapsed = time_seconds - previous_time;
        if looping {
            position = (position + elapsed % duration) % duration;
        } else if elapsed >= duration - position {
            position = duration;
            phase = "finished";
        } else {
            position += elapsed;
            // Addition may round up to the endpoint even when elapsed was
            // just below the subtraction-derived remaining interval.
            if position >= duration {
                position = duration;
                phase = "finished";
            }
        }
    }
    match action {
        Some("play") => {
            if position == duration {
                position = 0.0;
            }
            phase = "playing";
        }
        Some("pause") => {
            phase = "paused";
        }
        Some("stop") => {
            position = 0.0;
            phase = "stopped";
        }
        Some("seek") => {
            position = number(&command["positionSeconds"], 0.0, duration)?;
            if looping && position == duration {
                position = 0.0;
            }
            phase = "paused";
        }
        _ => {}
    }
    Ok(SceneAnimationResponse::Transported {
        scene_object_id: document["sceneObjectId"].as_str().unwrap().to_owned(),
        phase: phase.to_owned(),
        position_seconds: if position == 0.0 { 0.0 } else { position },
        time_seconds: if time_seconds == 0.0 {
            0.0
        } else {
            time_seconds
        },
    })
}

// A clip chooses a window in the original curves; no resampling, duplicated
// tracks or resource ownership is introduced. Whole-timeline selection is null.
fn clip_range(document: &Value, id: &Value) -> Result<(f64, f64, bool), CoreError> {
    if id.is_null() {
        return Ok((
            0.0,
            document["durationSeconds"].as_f64().unwrap(),
            document["loop"].as_bool().unwrap(),
        ));
    }
    uuid(id)?;
    let clip = document["clips"]
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .find(|clip| clip["id"] == *id)
        .ok_or_else(invalid)?;
    Ok((
        clip["startSeconds"].as_f64().unwrap(),
        clip["endSeconds"].as_f64().unwrap(),
        clip["loop"].as_bool().unwrap(),
    ))
}
fn clip_transport(
    document: &Value,
    state: &Value,
    time: &Value,
    command: &Value,
) -> Result<SceneAnimationResponse, CoreError> {
    if !state.is_null()
        && !exact(
            state,
            &[
                "sceneObjectId",
                "phase",
                "positionSeconds",
                "timeSeconds",
                "clipId",
            ],
        )
    {
        return Err(invalid());
    }
    let mut clip_id = if state.is_null() {
        Value::Null
    } else {
        state["clipId"].clone()
    };
    let (start, end, looping) = clip_range(document, &clip_id)?;
    let scoped = json!({"sceneObjectId":document["sceneObjectId"], "durationSeconds":end-start, "loop":looping});
    let mut previous = state.clone();
    if let Some(previous) = previous.as_object_mut() {
        previous.remove("clipId");
    }
    let selecting = command["action"] == "select";
    if selecting {
        if !exact(command, &["action", "clipId"]) {
            return Err(invalid());
        }
        clip_range(document, &command["clipId"])?;
        clip_id = command["clipId"].clone();
    }
    let advanced = transport(
        &scoped,
        &previous,
        time,
        if selecting { &Value::Null } else { command },
    )?;
    if let SceneAnimationResponse::Transported {
        scene_object_id,
        mut phase,
        mut position_seconds,
        time_seconds,
    } = advanced
    {
        if selecting {
            phase = "paused".into();
            position_seconds = 0.0;
        }
        Ok(SceneAnimationResponse::ClipTransported {
            scene_object_id,
            phase,
            position_seconds,
            time_seconds,
            clip_id,
        })
    } else {
        unreachable!()
    }
}

// Copy one existing visual channel to a caller-selected instance. Identity
// allocation and World membership belong to authoring; the pure core only
// accepts explicit IDs and preserves the original document and track order.
fn copy_track(
    document: &Value,
    source_track_id: &Value,
    target_instance_id: &Value,
    new_track_id: &Value,
) -> Result<Value, CoreError> {
    let source_id = uuid(source_track_id)?;
    let target_id = uuid(target_instance_id)?;
    let new_id = uuid(new_track_id)?;
    let tracks = document["tracks"].as_array().unwrap();
    let source = tracks
        .iter()
        .find(|track| track["id"] == source_id)
        .ok_or_else(invalid)?;
    if tracks.iter().any(|track| {
        track["id"] == new_id
            || track["instanceId"] == target_id && track["property"] == source["property"]
    }) {
        return Err(invalid());
    }
    let mut copied = source.clone();
    copied["id"] = new_track_id.clone();
    copied["instanceId"] = target_instance_id.clone();
    let mut candidate = document.clone();
    candidate["tracks"].as_array_mut().unwrap().push(copied);
    validate_document(&candidate)?;
    Ok(candidate)
}

// Authoring transformation only: rendering and transport clocks are untouched.
// Use a normal finite factor when available to avoid premature division
// underflow; otherwise normalize first to avoid an overflowing/tiny factor.
// Equal source instants remain equal; every distinct instant must
// remain ordered, including boundaries shared across tracks and named clips.
fn retime(document: &Value, duration: &Value) -> Result<Value, CoreError> {
    let next_duration = number(duration, 0.0, 60.0)?;
    if next_duration == 0.0 {
        return Err(invalid());
    }
    let previous_duration = document["durationSeconds"].as_f64().unwrap();
    if next_duration == previous_duration {
        return Ok(document.clone());
    }
    let ratio = next_duration / previous_duration;
    let normal_ratio = ratio.is_finite() && ratio >= f64::MIN_POSITIVE;
    let scaled = |time: f64| {
        if time == 0.0 {
            0.0
        } else if time == previous_duration {
            next_duration
        } else if normal_ratio {
            time * ratio
        } else {
            (time / previous_duration) * next_duration
        }
    };
    let mut times = vec![0.0, previous_duration];
    for track in document["tracks"].as_array().unwrap() {
        for key in track["keyframes"].as_array().unwrap() {
            times.push(key["atSeconds"].as_f64().unwrap());
        }
    }
    if let Some(clips) = document["clips"].as_array() {
        for clip in clips {
            times.push(clip["startSeconds"].as_f64().unwrap());
            times.push(clip["endSeconds"].as_f64().unwrap());
        }
    }
    // This detached validation set never reorders an author's list.
    times.sort_by(f64::total_cmp);
    times.dedup_by(|a, b| *a == *b);
    let mut previous = None;
    for time in times {
        let next = scaled(time);
        if !next.is_finite()
            || !(0.0..=next_duration).contains(&next)
            || previous.is_some_and(|value| next <= value)
        {
            return Err(invalid());
        }
        previous = Some(next);
    }
    let mut candidate = document.clone();
    candidate["durationSeconds"] = json!(next_duration);
    for track in candidate["tracks"].as_array_mut().unwrap() {
        for key in track["keyframes"].as_array_mut().unwrap() {
            key["atSeconds"] = json!(scaled(key["atSeconds"].as_f64().unwrap()));
        }
    }
    if let Some(clips) = candidate.get_mut("clips").and_then(Value::as_array_mut) {
        for clip in clips {
            for field in ["startSeconds", "endSeconds"] {
                clip[field] = json!(scaled(clip[field].as_f64().unwrap()));
            }
        }
    }
    // Includes canonical author budgets after longer float spellings are emitted.
    validate_document(&candidate)?;
    Ok(candidate)
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum SceneAnimationResponse {
    ClipTransported {
        #[serde(rename = "sceneObjectId")]
        scene_object_id: String,
        phase: String,
        #[serde(rename = "positionSeconds")]
        position_seconds: f64,
        #[serde(rename = "timeSeconds")]
        time_seconds: f64,
        #[serde(rename = "clipId")]
        clip_id: Value,
    },
    Transported {
        #[serde(rename = "sceneObjectId")]
        scene_object_id: String,
        phase: String,
        #[serde(rename = "positionSeconds")]
        position_seconds: f64,
        #[serde(rename = "timeSeconds")]
        time_seconds: f64,
    },
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
    let copying = request["operation"] == "sceneAnimation.copyTrack";
    let retiming = request["operation"] == "sceneAnimation.retime";
    let clip_sample = request["operation"] == "sceneAnimation.sampleClip";
    let clip_transporting = request["operation"] == "sceneAnimation.clipTransport";
    let sample = request["operation"] == "sceneAnimation.sample" || clip_sample;
    let transporting = request["operation"] == "sceneAnimation.transport" || clip_transporting;
    let fields: &[&str] = if copying {
        &[
            "protocolVersion",
            "operation",
            "document",
            "sourceTrackId",
            "targetInstanceId",
            "newTrackId",
        ]
    } else if retiming {
        &[
            "protocolVersion",
            "operation",
            "document",
            "durationSeconds",
        ]
    } else if transporting {
        &[
            "protocolVersion",
            "operation",
            "document",
            "state",
            "timeSeconds",
            "command",
        ]
    } else if clip_sample {
        &[
            "protocolVersion",
            "operation",
            "document",
            "clipId",
            "timeSeconds",
        ]
    } else if sample {
        &["protocolVersion", "operation", "document", "timeSeconds"]
    } else {
        &["protocolVersion", "operation", "document"]
    };
    if !exact(request, fields)
        || request["protocolVersion"].as_f64() != Some(1.0)
        || !sample
            && !transporting
            && !retiming
            && !copying
            && request["operation"] != "sceneAnimation.inspect"
    {
        return Err(CoreError::request());
    }
    let document = &request["document"];
    validate_document(document)?;
    if copying {
        return Ok(SceneAnimationResponse::Inspected {
            document: copy_track(
                document,
                &request["sourceTrackId"],
                &request["targetInstanceId"],
                &request["newTrackId"],
            )?,
        });
    }
    if retiming {
        return Ok(SceneAnimationResponse::Inspected {
            document: retime(document, &request["durationSeconds"])?,
        });
    }
    if (clip_sample || clip_transporting) && document["schemaVersion"].as_f64() != Some(3.0) {
        return Err(invalid());
    }
    if clip_transporting {
        return clip_transport(
            document,
            &request["state"],
            &request["timeSeconds"],
            &request["command"],
        );
    }
    if transporting {
        return transport(
            document,
            &request["state"],
            &request["timeSeconds"],
            &request["command"],
        );
    }
    if !sample {
        return Ok(SceneAnimationResponse::Inspected {
            document: document.clone(),
        });
    }
    let time_seconds = number(&request["timeSeconds"], 0.0, 86400.0)?;
    let (start, end, looping) = if clip_sample {
        clip_range(document, &request["clipId"])?
    } else {
        (
            0.0,
            document["durationSeconds"].as_f64().unwrap(),
            document["loop"].as_bool().unwrap(),
        )
    };
    let duration = end - start;
    let local_time_seconds = if looping {
        time_seconds % duration
    } else {
        time_seconds.min(duration)
    };
    // Normalize only in the selected range. A terminal nonloop clip must reach
    // the original final key even when the full animation is looping. Rounded
    // start+local endpoints are sampled directly, never normalized a second time.
    let sample_seconds = if local_time_seconds == duration {
        end
    } else {
        start + local_time_seconds
    };
    let values = document["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|track| {
            let mut sample = json!({
                "trackId":track["id"],"instanceId":track["instanceId"],"property":track["property"],
                "value":sample_track(track, sample_seconds)
            });
            if track["property"] == "spriteFrame2d" {
                sample["grid"] = track["grid"].clone();
            }
            sample
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
    fn sprite_doc() -> Value {
        let mut document = doc();
        document["schemaVersion"] = json!(2);
        document["tracks"][0] = json!({"id":id(2),"instanceId":id(3),"property":"spriteFrame2d",
            "interpolation":"step","grid":{"columns":4,"rows":2},
            "keyframes":[{"atSeconds":0,"value":0},{"atSeconds":0.5,"value":3},{"atSeconds":2,"value":7}]});
        document
    }
    #[test]
    fn sprite_samples_are_discrete_with_a_bound_grid_and_existing_time_semantics() {
        assert_eq!(crate::viento_core_scene_animation_version(), 1);
        assert_eq!(crate::viento_core_scene_animation_sprite_version(), 1);
        let document = sprite_doc();
        assert_eq!(run(document.clone(), None), json!({"document":document}));
        for (time, expected) in [
            (0.0, 0),
            (0.499999, 0),
            (0.5, 3),
            (1.5, 3),
            (2.0, 7),
            (86400.0, 7),
        ] {
            let sampled = run(document.clone(), Some(time));
            assert_eq!(sampled["values"][0]["value"], json!(expected));
            assert_eq!(sampled["values"][0]["grid"], json!({"columns":4,"rows":2}));
            assert_eq!(sampled["finished"], time >= 2.0);
        }
        let mut looping = document.clone();
        looping["loop"] = json!(true);
        for time in [0.0, 2.0, 4.0, 86400.0] {
            assert_eq!(
                run(looping.clone(), Some(time))["values"][0]["value"],
                json!(0)
            );
        }
        assert_eq!(
            run(looping.clone(), Some(2.5))["values"][0]["value"],
            json!(3)
        );
        assert_eq!(run(looping, Some(0.25))["values"][0]["value"], json!(0));
        let mut mixed = document;
        mixed["tracks"]
            .as_array_mut()
            .unwrap()
            .push(doc()["tracks"][0].clone());
        mixed["tracks"][1]["id"] = json!(id(4));
        let rows = run(mixed, Some(0.5))["values"].clone();
        assert_eq!(rows[0]["value"], json!(3));
        assert_eq!(rows[1]["value"], json!([10.0, 0.0]));
        assert!(rows[1].get("grid").is_none());
    }
    #[test]
    fn sprite_grids_and_indices_are_bounded_integers_with_exact_track_shapes() {
        for (path, invalid_value) in [
            ("/schemaVersion", json!(1)),
            ("/schemaVersion", json!(3)),
            ("/tracks/0/interpolation", json!("linear")),
            ("/tracks/0/grid", json!({"columns":4,"rows":2,"extra":1})),
            ("/tracks/0/grid", json!({"columns":4})),
            ("/tracks/0/grid", json!([4, 2])),
            ("/tracks/0/grid/columns", json!(0)),
            ("/tracks/0/grid/columns", json!(65)),
            ("/tracks/0/grid/rows", json!(1.5)),
            ("/tracks/0/grid/rows", json!("2")),
            ("/tracks/0/keyframes/0/value", json!(-1)),
            ("/tracks/0/keyframes/0/value", json!(8)),
            ("/tracks/0/keyframes/0/value", json!(0.5)),
            ("/tracks/0/keyframes/0/value", json!([0, 0])),
        ] {
            let mut document = sprite_doc();
            *document.pointer_mut(path).unwrap() = invalid_value;
            assert!(dispatch(&request(document, None)).is_err(), "{path}");
        }
        let mut maximum = sprite_doc();
        maximum["tracks"][0]["grid"] = json!({"columns":64.0,"rows":64.0});
        maximum["tracks"][0]["keyframes"] = json!([{"atSeconds":0,"value":4095.0}]);
        assert!(validate_document(&maximum).is_ok());
        maximum["tracks"][0]["keyframes"][0]["value"] = json!(4096);
        assert!(validate_document(&maximum).is_err());
        maximum["tracks"][0]["grid"] = json!({"columns":1,"rows":1});
        maximum["tracks"][0]["keyframes"][0]["value"] = json!(0);
        assert!(validate_document(&maximum).is_ok());
    }
    #[test]
    fn legacy_visual_tracks_stay_exact_and_sprite_channels_are_unique() {
        let mut legacy = doc();
        let before = run(legacy.clone(), Some(0.5));
        legacy["schemaVersion"] = json!(2);
        assert_eq!(run(legacy.clone(), Some(0.5)), before);
        legacy["tracks"][0]["grid"] = json!({"columns":1,"rows":1});
        assert!(validate_document(&legacy).is_err());
        legacy["schemaVersion"] = json!(1);
        assert!(validate_document(&legacy).is_err());
        let mut document = sprite_doc();
        let mut duplicate = document["tracks"][0].clone();
        duplicate["id"] = json!(id(4));
        document["tracks"].as_array_mut().unwrap().push(duplicate);
        assert!(validate_document(&document).is_err());
        document["tracks"][1]["instanceId"] = json!(id(5));
        assert!(validate_document(&document).is_ok());
        let wire = serde_json::to_string(&request(sprite_doc(), None))
            .unwrap()
            .replace("\"columns\":4", "\"columns\":3,\"col\\u0075mns\":4");
        assert_eq!(
            serde_json::to_value(crate::dispatch(wire.as_bytes())).unwrap()["errorCode"],
            "studio_core_request_invalid"
        );
    }
    fn transport_request(document: Value, state: Value, time: f64, command: Value) -> Value {
        json!({"protocolVersion":1,"operation":"sceneAnimation.transport","document":document,
            "state":state,"timeSeconds":time,"command":command})
    }
    fn transport_run(document: Value, state: Value, time: f64, command: Value) -> Value {
        serde_json::to_value(dispatch(&transport_request(document, state, time, command)).unwrap())
            .unwrap()
    }
    #[test]
    fn transport_autoplays_and_commands_advance_then_apply_at_the_same_clock() {
        let document = doc();
        let first = transport_run(document.clone(), Value::Null, 0.5, Value::Null);
        assert_eq!(
            first,
            json!({"sceneObjectId":id(1),"phase":"playing","positionSeconds":0.5,"timeSeconds":0.5})
        );
        let paused = transport_run(
            document.clone(),
            first.clone(),
            1.0,
            json!({"action":"pause"}),
        );
        assert_eq!(paused["positionSeconds"], 1.0);
        assert_eq!(paused["phase"], "paused");
        let stopped = transport_run(
            document.clone(),
            paused.clone(),
            1.0,
            json!({"action":"stop"}),
        );
        assert_eq!(stopped["positionSeconds"], 0.0);
        assert_eq!(stopped["phase"], "stopped");
        let seek = transport_run(
            document.clone(),
            stopped,
            1.0,
            json!({"action":"seek","positionSeconds":0.25}),
        );
        assert_eq!(seek["positionSeconds"], 0.25);
        assert_eq!(seek["phase"], "paused");
        let resumed = transport_run(document.clone(), seek, 100.0, json!({"action":"play"}));
        assert_eq!(resumed["positionSeconds"], 0.25);
        assert_eq!(resumed["phase"], "playing");
        let advanced = transport_run(document, resumed, 100.5, json!({"action":"play"}));
        assert_eq!(advanced["positionSeconds"], 0.75);
        assert_eq!(first["positionSeconds"], 0.5);
        assert_eq!(paused["timeSeconds"], 1.0);
    }
    #[test]
    fn transport_terminal_seek_resume_and_loop_boundaries_are_explicit() {
        let document = doc();
        let finished = transport_run(document.clone(), Value::Null, 86401.0, Value::Null);
        assert_eq!(finished["phase"], "finished");
        assert_eq!(finished["positionSeconds"], 2.0);
        let paused = transport_run(
            document.clone(),
            finished.clone(),
            86401.0,
            json!({"action":"pause"}),
        );
        assert_eq!(paused["phase"], "paused");
        assert_eq!(paused["positionSeconds"], 2.0);
        for state in [finished, paused] {
            let restarted =
                transport_run(document.clone(), state, 86401.0, json!({"action":"play"}));
            assert_eq!(restarted["phase"], "playing");
            assert_eq!(restarted["positionSeconds"], 0.0);
        }
        let mut looping = document.clone();
        looping["loop"] = json!(true);
        let at_end = transport_run(looping.clone(), Value::Null, 2.0, Value::Null);
        assert_eq!(at_end["phase"], "playing");
        assert_eq!(at_end["positionSeconds"], 0.0);
        let sought = transport_run(
            looping.clone(),
            at_end,
            2.0,
            json!({"action":"seek","positionSeconds":2}),
        );
        assert_eq!(sought["phase"], "paused");
        assert_eq!(sought["positionSeconds"], 0.0);
        let huge = transport_run(
            looping.clone(),
            json!({"sceneObjectId":id(1),"phase":"playing","positionSeconds":0.25,"timeSeconds":0}),
            9007199254740991.0,
            Value::Null,
        );
        assert_eq!(huge["phase"], "playing");
        assert_eq!(huge["positionSeconds"], 1.25);
        let unchanged = transport_run(looping, huge.clone(), 9007199254740991.0, Value::Null);
        assert_eq!(unchanged, huge);
    }
    #[test]
    fn transport_rejects_unbound_noncanonical_and_nonmonotonic_inputs() {
        let document = doc();
        let state = transport_run(document.clone(), Value::Null, 0.5, Value::Null);
        for (field, value) in [
            ("sceneObjectId", json!(id(9))),
            ("phase", json!("error")),
            ("positionSeconds", json!(-1)),
            ("timeSeconds", json!(-1)),
            ("extra", json!(1)),
        ] {
            let mut bad = state.clone();
            bad[field] = value;
            assert!(dispatch(&transport_request(document.clone(), bad, 0.5, Value::Null)).is_err());
        }
        for key in ["sceneObjectId", "phase", "positionSeconds", "timeSeconds"] {
            let mut bad = state.clone();
            bad.as_object_mut().unwrap().remove(key);
            assert!(dispatch(&transport_request(document.clone(), bad, 0.5, Value::Null)).is_err());
        }
        assert!(dispatch(&transport_request(
            document.clone(),
            state.clone(),
            0.49,
            Value::Null
        ))
        .is_err());
        assert!(dispatch(&transport_request(
            document.clone(),
            state.clone(),
            9007199254740992.0,
            Value::Null
        ))
        .is_err());
        for command in [
            json!({}),
            json!({"action":"restart"}),
            json!({"action":"seek"}),
            json!({"action":"seek","positionSeconds":2.1}),
            json!({"action":"play","positionSeconds":0}),
            json!({"action":"pause","extra":false}),
        ] {
            assert!(dispatch(&transport_request(
                document.clone(),
                state.clone(),
                1.0,
                command
            ))
            .is_err());
        }
        for (phase, position) in [("playing", 2.0), ("stopped", 0.5), ("finished", 0.5)] {
            let mut bad = state.clone();
            bad["phase"] = json!(phase);
            bad["positionSeconds"] = json!(position);
            assert!(dispatch(&transport_request(document.clone(), bad, 1.0, Value::Null)).is_err());
        }
        let mut looping = document;
        looping["loop"] = json!(true);
        let invalid_loop =
            json!({"sceneObjectId":id(1),"phase":"paused","positionSeconds":2,"timeSeconds":0});
        assert!(dispatch(&transport_request(looping, invalid_loop, 0.0, Value::Null)).is_err());
    }
}

#[cfg(test)]
mod clip_tests {
    use super::*;
    fn id(n: usize) -> String {
        format!("{n:08x}-1111-4111-8111-111111111111")
    }
    fn doc() -> Value {
        json!({"format":"viento-scene-animation","schemaVersion":3,"sceneObjectId":id(1),"durationSeconds":2,"loop":true,
            "tracks":[{"id":id(2),"instanceId":id(3),"property":"opacity","interpolation":"linear","keyframes":[{"atSeconds":0,"value":0},{"atSeconds":2,"value":1}]}],
            "clips":[{"id":id(4),"name":"攻撃 Attack","startSeconds":0.5,"endSeconds":2,"loop":false},{"id":id(5),"name":"待機","startSeconds":0.25,"endSeconds":0.75,"loop":true}]})
    }
    fn sample(document: Value, clip_id: Value, time: f64) -> Result<Value, CoreError> {
        dispatch(&json!({"protocolVersion":1,"operation":"sceneAnimation.sampleClip","document":document,"clipId":clip_id,"timeSeconds":time})).map(|v|serde_json::to_value(v).unwrap())
    }
    fn step(document: &Value, state: Value, time: f64, command: Value) -> Result<Value, CoreError> {
        dispatch(&json!({"protocolVersion":1,"operation":"sceneAnimation.clipTransport","document":document,"state":state,"timeSeconds":time,"command":command})).map(|v|serde_json::to_value(v).unwrap())
    }
    #[test]
    fn clip_sampling_uses_original_curves_once_and_preserves_full_timeline_defaults() {
        let document = doc();
        let start = sample(document.clone(), json!(id(4)), 0.0).unwrap();
        assert_eq!(start["localTimeSeconds"], 0.0);
        assert_eq!(start["values"][0]["value"], 0.25);
        let middle = sample(document.clone(), json!(id(4)), 0.5).unwrap();
        assert_eq!(middle["values"][0]["value"], 0.5);
        let end = sample(document.clone(), json!(id(4)), 1.5).unwrap();
        assert_eq!(end["values"][0]["value"], 1.0);
        assert_eq!(end["finished"], true);
        assert_eq!(
            sample(document.clone(), json!(id(4)), 86400.0).unwrap()["values"][0]["value"],
            1.0
        );
        let looping = sample(document.clone(), json!(id(5)), 0.5).unwrap();
        assert_eq!(looping["localTimeSeconds"], 0.0);
        assert_eq!(looping["values"][0]["value"], 0.125);
        let whole = sample(document, Value::Null, 2.0).unwrap();
        assert_eq!(whole["localTimeSeconds"], 0.0);
        assert_eq!(whole["values"][0]["value"], 0.0);
    }
    #[test]
    fn clip_transport_selects_paused_local_heads_and_preserves_same_clock_fifo() {
        let document = doc();
        let initial = step(&document, Value::Null, 0.5, Value::Null).unwrap();
        assert_eq!(initial["clipId"], Value::Null);
        assert_eq!(initial["positionSeconds"], 0.5);
        let selected = step(
            &document,
            initial,
            1.0,
            json!({"action":"select","clipId":id(4)}),
        )
        .unwrap();
        assert_eq!(selected["phase"], "paused");
        assert_eq!(selected["positionSeconds"], 0.0);
        let played = step(&document, selected, 1.0, json!({"action":"play"})).unwrap();
        let finished = step(&document, played, 2.5, Value::Null).unwrap();
        assert_eq!(finished["phase"], "finished");
        assert_eq!(finished["positionSeconds"], 1.5);
        let replay = step(&document, finished, 2.5, json!({"action":"play"})).unwrap();
        assert_eq!(replay["phase"], "playing");
        assert_eq!(replay["positionSeconds"], 0.0);
        let selected = step(
            &document,
            replay,
            3.0,
            json!({"action":"select","clipId":id(5)}),
        )
        .unwrap();
        assert!(step(
            &document,
            selected.clone(),
            3.0,
            json!({"action":"seek","positionSeconds":0.6})
        )
        .is_err());
        let boundary = step(
            &document,
            selected,
            3.0,
            json!({"action":"seek","positionSeconds":0.5}),
        )
        .unwrap();
        assert_eq!(boundary["positionSeconds"], 0.0);
        let whole = step(
            &document,
            boundary,
            3.0,
            json!({"action":"select","clipId":null}),
        )
        .unwrap();
        assert_eq!(whole["clipId"], Value::Null);
        assert_eq!(whole["phase"], "paused");
    }
    #[test]
    fn clips_validate_identity_label_limits_ranges_and_allow_overlapping_windows() {
        let document = doc();
        assert!(validate_document(&document).is_ok());
        for (pointer, value) in [
            ("/clips/0/name", json!("")),
            ("/clips/0/name", json!(" Attack")),
            ("/clips/0/name", json!("a\nb")),
            ("/clips/0/name", json!("\u{feff}x")),
            ("/clips/0/name", json!("🎬".repeat(129))),
            ("/clips/0/startSeconds", json!(2)),
            ("/clips/0/endSeconds", json!(2.1)),
            ("/clips/0/id", json!(id(5))),
            ("/clips/0/loop", json!(1)),
        ] {
            let mut bad = document.clone();
            *bad.pointer_mut(pointer).unwrap() = value;
            assert!(validate_document(&bad).is_err(), "{pointer}");
        }
        let mut good = document.clone();
        good["clips"][0]["name"] = json!("🎬".repeat(128));
        assert!(validate_document(&good).is_ok());
        good["clips"] = json!([]);
        assert!(validate_document(&good).is_ok());
        let mut bad = document.clone();
        bad["clips"][0]["extra"] = json!(true);
        assert!(validate_document(&bad).is_err());
        let mut bad = document;
        bad.as_object_mut().unwrap().remove("clips");
        assert!(validate_document(&bad).is_err());
    }
    #[test]
    fn clip_transport_rejects_cross_scene_removed_clip_noncanonical_and_reverse_clock_state() {
        let document = doc();
        let selected = step(
            &document,
            Value::Null,
            1.0,
            json!({"action":"select","clipId":id(4)}),
        )
        .unwrap();
        for (key, value) in [
            ("sceneObjectId", json!(id(9))),
            ("clipId", json!(id(9))),
            ("phase", json!("playing")),
            ("positionSeconds", json!(1.6)),
            ("extra", json!(0)),
        ] {
            let mut bad = selected.clone();
            bad[key] = value;
            if key == "phase" {
                bad["positionSeconds"] = json!(1.5);
            }
            assert!(step(&document, bad, 1.0, Value::Null).is_err());
        }
        assert!(step(&document, selected.clone(), 0.5, Value::Null).is_err());
        assert!(step(&document, selected.clone(), 1.0, json!({"action":"select"})).is_err());
        assert!(step(
            &document,
            selected.clone(),
            1.0,
            json!({"action":"select","clipId":id(9)})
        )
        .is_err());
        let mut missing = selected;
        missing.as_object_mut().unwrap().remove("clipId");
        assert!(step(&document, missing, 1.0, Value::Null).is_err());
    }
    #[test]
    fn clip_transport_preserves_large_clocks_and_sample_rejects_legacy_documents() {
        let document = doc();
        let selected = step(
            &document,
            Value::Null,
            0.0,
            json!({"action":"select","clipId":id(5)}),
        )
        .unwrap();
        let sought = step(
            &document,
            selected,
            0.0,
            json!({"action":"seek","positionSeconds":0.125}),
        )
        .unwrap();
        let playing = step(&document, sought, 0.0, json!({"action":"play"})).unwrap();
        let end = step(&document, playing, 9007199254740991.0, Value::Null).unwrap();
        assert_eq!(end["positionSeconds"], 0.125);
        let mut legacy = document;
        legacy["schemaVersion"] = json!(1);
        legacy.as_object_mut().unwrap().remove("clips");
        assert!(sample(legacy.clone(), Value::Null, 0.0).is_err());
        assert!(step(&legacy, Value::Null, 0.0, Value::Null).is_err());
    }
}

#[cfg(test)]
mod retime_tests {
    use super::*;
    fn id(n: usize) -> String {
        format!("{n:08x}-1111-4111-8111-111111111111")
    }
    fn doc(version: u32) -> Value {
        let mut value = json!({"format":"viento-scene-animation","schemaVersion":version,
            "sceneObjectId":id(1),"durationSeconds":2,"loop":true,
            "tracks":[{"id":id(2),"instanceId":id(3),"property":"opacity","interpolation":"linear",
                "keyframes":[{"atSeconds":0,"value":0},{"atSeconds":0.5,"value":0.7},{"atSeconds":2,"value":1}]}]});
        if version >= 2 {
            value["tracks"].as_array_mut().unwrap().push(json!({"id":id(6),"instanceId":id(3),
                "property":"spriteFrame2d","interpolation":"step","grid":{"columns":4,"rows":2},
                "keyframes":[{"atSeconds":0,"value":0},{"atSeconds":1,"value":3},{"atSeconds":2,"value":7}]}));
        }
        if version == 3 {
            value["clips"] = json!([
                {"id":id(4),"name":"攻撃 Attack","startSeconds":1,"endSeconds":2,"loop":false},
                {"id":id(5),"name":"待機","startSeconds":0.25,"endSeconds":0.5,"loop":true}
            ]);
        }
        value
    }
    fn request(document: Value, duration: Value) -> Value {
        json!({"protocolVersion":1,"operation":"sceneAnimation.retime","document":document,"durationSeconds":duration})
    }
    fn run(document: &Value, duration: f64) -> Value {
        let response = dispatch(&request(document.clone(), json!(duration))).unwrap();
        serde_json::to_value(response).unwrap()["document"].clone()
    }
    #[test]
    fn retime_scales_all_formats_without_reordering_or_changing_values() {
        assert_eq!(crate::viento_core_scene_animation_retime_version(), 1);
        for version in 1..=3 {
            let document = doc(version);
            for duration in [0.25, 1.0, 4.0, 60.0] {
                let result = run(&document, duration);
                let mut expected = document.clone();
                expected["durationSeconds"] = json!(duration);
                for track in expected["tracks"].as_array_mut().unwrap() {
                    for key in track["keyframes"].as_array_mut().unwrap() {
                        key["atSeconds"] =
                            json!(key["atSeconds"].as_f64().unwrap() * (duration / 2.0));
                    }
                }
                if version == 3 {
                    for clip in expected["clips"].as_array_mut().unwrap() {
                        for field in ["startSeconds", "endSeconds"] {
                            clip[field] = json!(clip[field].as_f64().unwrap() * (duration / 2.0));
                        }
                    }
                }
                assert_eq!(result, expected);
                assert!(validate_document(&result).is_ok());
            }
            assert_eq!(document, doc(version));
        }
    }
    #[test]
    fn retime_equal_duration_is_exact_even_for_very_small_interior_instants() {
        let mut document = doc(1);
        document["durationSeconds"] = json!(60.0);
        document["tracks"][0]["keyframes"][1]["atSeconds"] = json!(f64::from_bits(1));
        assert_eq!(run(&document, 60.0), document);
        let mut empty_clips = doc(3);
        empty_clips["clips"] = json!([]);
        assert_eq!(run(&empty_clips, 2.0), empty_clips);
    }
    #[test]
    fn retime_uses_normal_factors_and_normalized_fallback_without_overflow() {
        let tiny = f64::from_bits(1);
        let mut document = doc(1);
        document["durationSeconds"] = json!(30.0);
        document["tracks"][0]["keyframes"][1]["atSeconds"] = json!(tiny);
        document["tracks"][0]["keyframes"][2]["atSeconds"] = json!(30.0);
        let result = run(&document, 29.0);
        assert_eq!(
            result["tracks"][0]["keyframes"][1]["atSeconds"],
            json!(tiny)
        );
        assert_eq!(
            result["tracks"][0]["keyframes"][2]["atSeconds"],
            json!(29.0)
        );
        document["durationSeconds"] = json!(tiny * 4.0);
        document["tracks"][0]["keyframes"][2]["atSeconds"] = json!(tiny * 4.0);
        let result = run(&document, 60.0);
        assert_eq!(
            result["tracks"][0]["keyframes"][1]["atSeconds"],
            json!(15.0)
        );
        assert_eq!(
            result["tracks"][0]["keyframes"][2]["atSeconds"],
            json!(60.0)
        );
        document["durationSeconds"] = json!(2.0);
        document["tracks"][0]["keyframes"][1]["atSeconds"] = json!(1.0);
        document["tracks"][0]["keyframes"][2]["atSeconds"] = json!(2.0);
        let result = run(&document, tiny * 4.0);
        assert_eq!(
            result["tracks"][0]["keyframes"][1]["atSeconds"],
            json!(tiny * 2.0)
        );
    }
    #[test]
    fn retime_rejects_distinct_global_instants_collapsing_across_tracks_or_clips() {
        let mut document = doc(2);
        document["tracks"][0]["keyframes"][1]["atSeconds"] = json!(0.1);
        document["tracks"][1]["keyframes"][1]["atSeconds"] = json!(0.10000000000000002);
        assert!(validate_document(&document).is_ok());
        assert!(dispatch(&request(document, json!(0.1))).is_err());
        let mut document = doc(3);
        document["tracks"][0]["keyframes"][1]["atSeconds"] = json!(0.1);
        document["clips"][0]["startSeconds"] = json!(0.10000000000000002);
        assert!(validate_document(&document).is_ok());
        assert!(dispatch(&request(document, json!(0.1))).is_err());
        let mut document = doc(3);
        document["clips"][0]["startSeconds"] = json!(0.1);
        document["clips"][0]["endSeconds"] = json!(0.10000000000000002);
        assert!(dispatch(&request(document, json!(0.1))).is_err());
    }
    #[test]
    fn retime_rejects_endpoint_underflow_without_clamping_or_merging() {
        let mut document = doc(1);
        document["tracks"][0]["keyframes"][1]["atSeconds"] = json!(f64::from_bits(1));
        assert!(dispatch(&request(document, json!(0.1))).is_err());
        let mut document = doc(3);
        document["clips"][0]["startSeconds"] = json!(f64::from_bits(1));
        assert!(dispatch(&request(document, json!(0.1))).is_err());
    }
    #[test]
    fn retime_revalidates_input_and_exact_envelopes_without_promoting_formats() {
        for duration in [
            json!(0),
            json!(-1),
            json!(60.01),
            json!("2"),
            Value::Null,
            json!(false),
        ] {
            assert_eq!(
                dispatch(&request(doc(1), duration)).unwrap_err().error_code,
                "scene_animation_invalid"
            );
        }
        let mut bad = doc(1);
        bad["tracks"][0]["keyframes"][0]["atSeconds"] = json!(0.1);
        assert_eq!(
            dispatch(&request(bad, json!(2))).unwrap_err().error_code,
            "scene_animation_invalid"
        );
        let mut wire = request(doc(1), json!(3));
        wire["extra"] = json!(true);
        assert_eq!(
            dispatch(&wire).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        wire.as_object_mut().unwrap().remove("extra");
        wire.as_object_mut().unwrap().remove("durationSeconds");
        assert_eq!(
            dispatch(&wire).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        let raw = serde_json::to_string(&request(doc(1), json!(3))).unwrap();
        let duplicate = raw.replace(
            "\"durationSeconds\":3",
            "\"durationSeconds\":4,\"durationSeconds\":3",
        );
        assert_eq!(
            serde_json::to_value(crate::dispatch(duplicate.as_bytes())).unwrap()["errorCode"],
            "studio_core_request_invalid"
        );
    }
}

#[cfg(test)]
mod track_copy_tests {
    use super::*;
    fn id(n: usize) -> String {
        format!("{n:08x}-1111-4111-8111-111111111111")
    }
    fn doc(version: u32) -> Value {
        let mut value = json!({"format":"viento-scene-animation","schemaVersion":version,
            "sceneObjectId":id(1),"durationSeconds":2,"loop":true,
            "tracks":[{"id":id(2),"instanceId":id(3),"property":"offset2d","interpolation":"linear",
                "keyframes":[{"atSeconds":0,"value":[0,10]},{"atSeconds":0.5,"value":[1,2]},{"atSeconds":2,"value":[20,-10]}]}]});
        if version >= 2 {
            value["tracks"].as_array_mut().unwrap().push(json!({"id":id(6),"instanceId":id(3),
                "property":"spriteFrame2d","interpolation":"step","grid":{"columns":4,"rows":2},
                "keyframes":[{"atSeconds":0,"value":0},{"atSeconds":1,"value":3},{"atSeconds":2,"value":7}]}));
        }
        if version == 3 {
            value["clips"] = json!([
                {"id":id(4),"name":"攻撃 Attack","startSeconds":1,"endSeconds":2,"loop":false},
                {"id":id(5),"name":"待機","startSeconds":0.25,"endSeconds":0.5,"loop":true}
            ]);
        }
        value
    }
    fn request(document: Value, source: Value, target: Value, new: Value) -> Value {
        json!({"protocolVersion":1,"operation":"sceneAnimation.copyTrack","document":document,
            "sourceTrackId":source,"targetInstanceId":target,"newTrackId":new})
    }
    fn run(document: &Value, source: usize, target: usize, new: usize) -> Result<Value, CoreError> {
        dispatch(&request(
            document.clone(),
            json!(id(source)),
            json!(id(target)),
            json!(id(new)),
        ))
        .map(|value| serde_json::to_value(value).unwrap()["document"].clone())
    }
    fn repeated_tracks(count: usize, key_count: usize) -> Value {
        let mut document = doc(1);
        let base = document["tracks"][0].clone();
        document["tracks"] = Value::Array(
            (0..count)
                .map(|i| {
                    let mut track = base.clone();
                    track["id"] = json!(id(10 + i));
                    track["instanceId"] = json!(id(100 + i));
                    track["keyframes"] = Value::Array(
                        (0..key_count)
                            .map(|j| json!({"atSeconds":j as f64 / 32.0,"value":[0,10]}))
                            .collect(),
                    );
                    track
                })
                .collect(),
        );
        document
    }
    #[test]
    fn track_copy_preserves_all_schemas_grids_curves_clips_and_original_order() {
        assert_eq!(crate::viento_core_scene_animation_track_copy_version(), 1);
        for version in 1..=3 {
            let document = doc(version);
            for source in if version == 1 { vec![2] } else { vec![2, 6] } {
                let result = run(&document, source, 99, 98).unwrap();
                let mut expected = document.clone();
                let mut copied = document["tracks"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|t| t["id"] == id(source))
                    .unwrap()
                    .clone();
                copied["id"] = json!(id(98));
                copied["instanceId"] = json!(id(99));
                expected["tracks"].as_array_mut().unwrap().push(copied);
                assert_eq!(result, expected);
                assert!(validate_document(&result).is_ok());
            }
            assert_eq!(document, doc(version));
        }
    }
    #[test]
    fn track_copy_rejects_missing_source_duplicate_track_id_and_target_channel() {
        let document = doc(3);
        for (source, target, new) in [(99, 98, 97), (2, 99, 2), (2, 3, 98), (6, 3, 98)] {
            assert!(run(&document, source, target, new).is_err());
        }
        // Track IDs are unique among tracks; clips retain their separate IDs.
        assert!(run(&document, 2, 99, 4).is_ok());
        let mut target = document;
        target["tracks"][1]["instanceId"] = json!(id(99));
        assert!(run(&target, 2, 99, 98).is_ok());
        let mut duplicate = target.clone();
        duplicate["tracks"][1] = duplicate["tracks"][0].clone();
        duplicate["tracks"][1]["id"] = json!(id(6));
        duplicate["tracks"][1]["instanceId"] = json!(id(99));
        assert!(run(&duplicate, 2, 99, 98).is_err());
    }
    #[test]
    fn track_copy_revalidates_32_track_64_per_track_and_512_total_key_budgets() {
        assert_eq!(
            run(&repeated_tracks(31, 1), 10, 999, 998).unwrap()["tracks"]
                .as_array()
                .unwrap()
                .len(),
            32
        );
        assert!(run(&repeated_tracks(32, 1), 10, 999, 998).is_err());
        let boundary = run(&repeated_tracks(7, 64), 10, 999, 998).unwrap();
        assert_eq!(
            boundary["tracks"]
                .as_array()
                .unwrap()
                .iter()
                .map(|t| t["keyframes"].as_array().unwrap().len())
                .sum::<usize>(),
            512
        );
        assert!(run(&repeated_tracks(8, 64), 10, 999, 998).is_err());
        assert!(run(&repeated_tracks(1, 65), 10, 999, 998).is_err());
    }
    #[test]
    fn track_copy_rejects_result_bytes_even_with_legal_track_and_key_counts() {
        let mut document = doc(3);
        let base = document["tracks"][0].clone();
        document["tracks"] = Value::Array((0..31).map(|i| {
            let mut track=base.clone();track["id"]=json!(id(10+i));track["instanceId"]=json!(id(100+i));
            let count=if i==0 {64} else if i<=24 {13} else {12};
            track["keyframes"]=Value::Array((0..count).map(|j|json!({"atSeconds":j as f64 * 0.030123456789123,"value":[9999.123456789123,-9999.123456789123]})).collect());
            track
        }).collect());
        document["clips"] = Value::Array(
            (0..32)
                .map(|i| {
                    json!({"id":id(200+i),"name":"🎬".repeat(128),
            "startSeconds":0.12345678901234567,"endSeconds":1.9876543210987654,"loop":false})
                })
                .collect(),
        );
        assert!(validate_document(&document).is_ok());
        assert!(serde_json::to_vec(&document).unwrap().len() < 65536);
        let mut appended = document.clone();
        let mut track = appended["tracks"][0].clone();
        track["id"] = json!(id(998));
        track["instanceId"] = json!(id(999));
        appended["tracks"].as_array_mut().unwrap().push(track);
        assert!(serde_json::to_vec(&appended).unwrap().len() > 65536);
        assert_eq!(
            run(&document, 10, 999, 998).unwrap_err().error_code,
            "scene_animation_invalid"
        );
    }
    #[test]
    fn track_copy_validates_all_three_ids_and_the_original_document() {
        for bad in [
            Value::Null,
            json!(false),
            json!(0),
            json!(""),
            json!("ABCDEFAB-1111-4111-8111-111111111111"),
        ] {
            for field in ["sourceTrackId", "targetInstanceId", "newTrackId"] {
                let mut value = request(doc(1), json!(id(2)), json!(id(99)), json!(id(98)));
                value[field] = bad.clone();
                assert_eq!(
                    dispatch(&value).unwrap_err().error_code,
                    "scene_animation_invalid"
                );
            }
        }
        let mut malformed = doc(3);
        malformed["clips"][0]["endSeconds"] = json!(3);
        assert!(run(&malformed, 2, 99, 98).is_err());
        let mut malformed = doc(1);
        malformed["tracks"][0]["keyframes"][0]["atSeconds"] = json!(0.1);
        assert!(run(&malformed, 2, 99, 98).is_err());
    }
    #[test]
    fn track_copy_rejects_missing_extra_and_duplicate_decoded_request_fields() {
        let value = request(doc(1), json!(id(2)), json!(id(99)), json!(id(98)));
        for field in [
            "protocolVersion",
            "operation",
            "document",
            "sourceTrackId",
            "targetInstanceId",
            "newTrackId",
        ] {
            let mut missing = value.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert_eq!(
                dispatch(&missing).unwrap_err().error_code,
                "studio_core_request_invalid"
            );
        }
        let mut extra = value.clone();
        extra["extra"] = json!(true);
        assert_eq!(
            dispatch(&extra).unwrap_err().error_code,
            "studio_core_request_invalid"
        );
        let raw = serde_json::to_string(&value).unwrap();
        let duplicate = raw.replace(
            "\"sourceTrackId\":",
            "\"sourceTrackId\":null,\"sourceTr\\u0061ckId\":",
        );
        assert_eq!(
            serde_json::to_value(crate::dispatch(duplicate.as_bytes())).unwrap()["errorCode"],
            "studio_core_request_invalid"
        );
    }
}
