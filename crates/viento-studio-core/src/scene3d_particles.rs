//! Deterministic bounded particle parameters, phases and explicit-time offsets.
//! No clock, rendering, scene mutation, IO, force model or backend assumptions.
#![forbid(unsafe_code)]
use crate::{scene3d::triple, CoreError};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) const FIELDS: [&str; 7] = [
    "center", "extent", "velocity", "size", "color", "count", "seed",
];
pub(crate) fn invalid() -> CoreError {
    CoreError { error_code: "scene3d_particles_invalid", message: "Expected a complete bounded particle field and explicit time from zero to 3600 seconds." }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StrictField {
    #[serde(rename = "center")]
    _center: Value,
    #[serde(rename = "extent")]
    _extent: Value,
    #[serde(rename = "velocity")]
    _velocity: Value,
    #[serde(rename = "size")]
    _size: Value,
    #[serde(rename = "color")]
    _color: Value,
    #[serde(rename = "count")]
    _count: Value,
    #[serde(rename = "seed")]
    _seed: Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictRequest {
    #[serde(rename = "protocolVersion")]
    _protocol_version: Value,
    #[serde(rename = "operation")]
    _operation: Value,
    #[serde(rename = "field")]
    _field: StrictField,
    #[serde(rename = "timeSeconds")]
    _time_seconds: Option<Value>,
}
pub(crate) fn validate_request_bytes(input: &[u8]) -> Result<(), CoreError> {
    serde_json::from_slice::<StrictRequest>(input)
        .map(|_| ())
        .map_err(|_| CoreError::request())
}
pub(crate) struct Field {
    pub(crate) extent: [f64; 3],
    pub(crate) velocity: [f64; 3],
    pub(crate) count: u32,
    pub(crate) seed: u32,
}
pub(crate) fn validate_field(value: &Value) -> Result<Field, CoreError> {
    let object = value.as_object().ok_or_else(invalid)?;
    if object.len() != FIELDS.len() || FIELDS.iter().any(|name| !object.contains_key(*name)) {
        return Err(invalid());
    }
    triple(&value["center"], -100000.0, 100000.0).map_err(|_| invalid())?;
    let extent = triple(&value["extent"], 0.01, 10000.0).map_err(|_| invalid())?;
    let velocity = triple(&value["velocity"], -1000.0, 1000.0).map_err(|_| invalid())?;
    let size = triple(&value["size"], 0.001, 1000.0).map_err(|_| invalid())?;
    if size.iter().zip(extent).any(|(size, extent)| *size > extent) {
        return Err(invalid());
    }
    let color = value["color"].as_str().ok_or_else(invalid)?;
    if color.len() != 7
        || !color.starts_with('#')
        || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    {
        return Err(invalid());
    }
    let integer = |name: &str, max: f64| -> Result<u32, CoreError> {
        let number = value[name].as_f64().ok_or_else(invalid)?;
        if !number.is_finite() || number < 0.0 || number > max || number.fract() != 0.0 {
            return Err(invalid());
        }
        Ok(number as u32)
    };
    Ok(Field {
        extent,
        velocity,
        count: integer("count", 4096.0)?,
        seed: integer("seed", 4294967295.0)?,
    })
}
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ParticleFieldResponse {
    Prepared {
        field: Value,
        phases: Vec<[f64; 3]>,
    },
    Sampled {
        #[serde(rename = "timeSeconds")]
        time_seconds: f64,
        offset: [f64; 3],
    },
}
pub(crate) fn dispatch(request: &Value) -> Result<ParticleFieldResponse, CoreError> {
    let object = request.as_object().ok_or_else(CoreError::request)?;
    let sample = request["operation"].as_str() == Some("scene3d.sampleParticleField");
    let keys = if sample {
        vec!["protocolVersion", "operation", "field", "timeSeconds"]
    } else {
        vec!["protocolVersion", "operation", "field"]
    };
    if object.len() != keys.len()
        || keys.iter().any(|key| !object.contains_key(*key))
        || request["protocolVersion"].as_f64() != Some(1.0)
        || !sample && request["operation"].as_str() != Some("scene3d.prepareParticleField")
    {
        return Err(CoreError::request());
    }
    let field = validate_field(&request["field"])?;
    if sample {
        let time = request["timeSeconds"].as_f64().ok_or_else(invalid)?;
        if !time.is_finite() || !(0.0..=3600.0).contains(&time) {
            return Err(invalid());
        }
        let offset = std::array::from_fn(|axis| {
            let value = (field.velocity[axis] * time / field.extent[axis]).rem_euclid(1.0);
            if value >= 1.0 || value == 0.0 {
                0.0
            } else {
                value
            }
        });
        Ok(ParticleFieldResponse::Sampled {
            time_seconds: time,
            offset,
        })
    } else {
        let mut state = field.seed ^ 0x9e37_79b9;
        if state == 0 {
            state = 0x6d2b_79f5;
        }
        let phases = (0..field.count)
            .map(|_| {
                std::array::from_fn(|_| {
                    state ^= state << 13;
                    state ^= state >> 17;
                    state ^= state << 5;
                    f64::from(state >> 8) / 16777216.0
                })
            })
            .collect();
        Ok(ParticleFieldResponse::Prepared {
            field: request["field"].clone(),
            phases,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn field() -> Value {
        json!({"center":[0,2,0],"extent":[10,5,8],"velocity":[-3,2.5,0.001],"size":[0.1,0.2,0.1],"color":"#aBcDeF","count":2,"seed":0})
    }
    fn request(value: Value, time: Option<f64>) -> Value {
        match time {
            Some(time) => {
                json!({"protocolVersion":1,"operation":"scene3d.sampleParticleField","field":value,"timeSeconds":time})
            }
            None => {
                json!({"protocolVersion":1,"operation":"scene3d.prepareParticleField","field":value})
            }
        }
    }
    fn result(value: Value, time: Option<f64>) -> Value {
        serde_json::to_value(dispatch(&request(value, time)).unwrap()).unwrap()
    }
    fn source() -> String {
        format!(
            "\u{feff}{}\r\n \t",
            include_str!("../../../examples/scene3d/scene.json")
                .trim_end()
                .replace('\n', "\r\n")
        )
    }
    #[test]
    fn deterministic_sequence_matches_known_float32_phase_values_and_seed_zero_remains_valid() {
        let expected = json!([
            [0.3165935277938843, 0.8757069706916809, 0.4833001494407654],
            [0.005915164947509766, 0.899222195148468, 0.9747592210769653]
        ]);
        let prepared = result(field(), None);
        assert_eq!(prepared["phases"], expected);
        assert_eq!(prepared["field"], field());
        assert_eq!(result(field(), None), prepared);
        let mut other = field();
        other["seed"] = json!(2654435769u32);
        assert_eq!(
            result(other, None)["phases"][0],
            json!([0.2526668906211853, 0.5698249340057373, 0.609617292881012])
        );
    }
    #[test]
    fn disabled_empty_and_maximum_count_are_bounded_and_every_phase_is_exact_float32() {
        let mut value = field();
        value["count"] = json!(0);
        assert_eq!(result(value.clone(), None)["phases"], json!([]));
        value["count"] = json!(4096);
        value["seed"] = json!(4294967295u32);
        let prepared = result(value, None);
        let phases = prepared["phases"].as_array().unwrap();
        assert_eq!(phases.len(), 4096);
        for phase in phases {
            assert_eq!(phase.as_array().unwrap().len(), 3);
            for value in phase.as_array().unwrap() {
                let n = value.as_f64().unwrap();
                assert!((0.0..1.0).contains(&n));
                assert_eq!(f64::from(n as f32), n);
            }
        }
    }
    #[test]
    fn explicit_time_sampling_supports_negative_velocity_wrap_and_random_access_without_state() {
        let at_half = result(field(), Some(0.5));
        assert_eq!(
            at_half,
            json!({"timeSeconds":0.5,"offset":[0.85,0.25,0.0000625]})
        );
        assert_eq!(
            result(field(), Some(0.0)),
            json!({"timeSeconds":0.0,"offset":[0.0,0.0,0.0]})
        );
        let before = result(field(), Some(3600.0));
        result(field(), Some(0.001));
        assert_eq!(result(field(), Some(3600.0)), before);
        assert_eq!(before["offset"], json!([0.0, 0.0, 0.45]));
    }
    #[test]
    fn tiny_negative_offset_rounded_to_one_is_canonical_zero_and_time_bounds_are_strict() {
        let mut value = field();
        value["velocity"] = json!([-5e-324, 0, 0]);
        let sample = result(value, Some(1.0));
        assert_eq!(sample["offset"], json!([0.0, 0.0, 0.0]));
        for time in [-0.1, 3600.0001] {
            assert_eq!(
                dispatch(&request(field(), Some(time)))
                    .unwrap_err()
                    .error_code,
                "scene3d_particles_invalid"
            );
        }
    }
    #[test]
    fn field_requires_exact_complete_bounded_vectors_color_integers_and_size_inside_extent() {
        for (path, value) in [
            ("/center", json!([100001, 0, 0])),
            ("/extent", json!([0, 1, 1])),
            ("/extent", json!([10001, 1, 1])),
            ("/velocity", json!([0, -1001, 0])),
            ("/size", json!([0.0001, 0.1, 0.1])),
            ("/size", json!([11, 0.1, 0.1])),
            ("/count", json!(4097)),
            ("/count", json!(0.5)),
            ("/seed", json!(4294967296u64)),
            ("/seed", json!(-1)),
            ("/color", json!("#abcd")),
            ("/center", json!([0, 0])),
            ("/velocity", json!([0, null, 0])),
        ] {
            let mut bad = field();
            *bad.pointer_mut(path).unwrap() = value;
            assert!(validate_field(&bad).is_err(), "{path}");
        }
        let mut bad = field();
        bad["preset"] = json!("rain");
        assert!(validate_field(&bad).is_err());
        bad.as_object_mut().unwrap().remove("preset");
        bad.as_object_mut().unwrap().remove("seed");
        assert!(validate_field(&bad).is_err());
    }
    #[test]
    fn field_coordinates_boundaries_do_not_impose_camera_or_object_count_rules() {
        let value = json!({"center":[-100000,100000,0],"extent":[0.01,10000,1000],"velocity":[-1000,1000,0],"size":[0.01,1000,1000],"color":"#FFFFFF","count":4096.0,"seed":4294967295.0});
        assert!(validate_field(&value).is_ok());
        assert_eq!(
            result(value, Some(3600.0))["offset"],
            json!([0.0, 0.0, 0.0])
        );
    }
    #[test]
    fn absent_particle_field_stays_absent_and_present_declarations_remain_author_values() {
        let text = source();
        assert!(crate::scene3d::parse(&text)
            .unwrap()
            .model
            .get("particleField")
            .is_none());
        let at = text.rfind('}').unwrap();
        let content = format!(
            "{},\"particleField\":{}{}",
            &text[..at],
            field(),
            &text[at..]
        );
        let parsed = crate::scene3d::parse(&content).unwrap();
        assert_eq!(parsed.model["particleField"], field());
        assert_eq!(parsed.model["schemaVersion"], 1);
        let duplicate = content.replace("\"seed\":0", "\"seed\":0,\"se\\u0065d\":1");
        assert!(crate::scene3d::parse(&duplicate).is_err());
    }
    #[test]
    fn particle_and_fog_insertion_are_canonical_ordered_spans_without_changing_any_original_bytes()
    {
        let text = source();
        let values = json!({"particleField":field(),"fog":{"color":"#123456","density":0.125}});
        let patched=crate::scene3d_environment_patch::dispatch(&json!({"protocolVersion":1,"operation":"scene3d.patchEnvironment","content":text,"values":values})).unwrap();
        let at = text.rfind('}').unwrap();
        let insertion=",\"fog\":{\"color\":\"#123456\",\"density\":0.125},\"particleField\":{\"center\":[0,2,0],\"extent\":[10,5,8],\"velocity\":[-3,2.5,0.001],\"size\":[0.1,0.2,0.1],\"color\":\"#aBcDeF\",\"count\":2,\"seed\":0}";
        assert_eq!(
            patched.after_content,
            format!("{}{}{}", &text[..at], insertion, &text[at..])
        );
        assert_eq!(patched.changed_paths, ["/fog", "/particleField"]);
    }
    #[test]
    fn existing_particle_updates_only_changed_leaf_tokens_and_count_zero_does_not_remove_field() {
        let text = source();
        let at = text.rfind('}').unwrap();
        let text=format!("{},\"particleField\":{{\"center\":[0,2,0],\"extent\":[10,5,8],\"velocity\":[-3,2.5,0.001],\"size\":[0.1,0.2,0.1],\"color\":\"#aBcDeF\",\"co\\u0075nt\":2e0,\"seed\":0}}{}",&text[..at],&text[at..]);
        let mut changed = field();
        changed["count"] = json!(0);
        let patched=crate::scene3d_environment_patch::dispatch(&json!({"protocolVersion":1,"operation":"scene3d.patchEnvironment","content":text,"values":{"particleField":changed}})).unwrap();
        assert_eq!(patched.after_content, text.replace("2e0", "0"));
        assert_eq!(patched.changed_paths, ["/particleField/count"]);
        assert_eq!(
            crate::scene3d::parse(&patched.after_content).unwrap().model["particleField"]["count"],
            0
        );
    }
    #[test]
    fn raw_request_duplicate_keys_including_null_and_operation_specific_extras_are_rejected() {
        let base = request(field(), None).to_string();
        for raw in [
            base.replace("\"seed\":0", "\"seed\":null,\"se\\u0065d\":0"),
            base.replace("\"field\":", "\"field\":null,\"fie\\u006cd\":"),
            base.replace(
                "\"protocolVersion\":1",
                "\"protocolVersion\":1,\"protocolVersion\":1",
            ),
            base.replacen('{', "{\"timeSeconds\":0,", 1),
        ] {
            let reply: Value =
                serde_json::from_slice(&crate::dispatch_json(raw.as_bytes())).unwrap();
            assert_eq!(reply["ok"], false);
            assert_eq!(reply["errorCode"], "studio_core_request_invalid");
        }
    }
}
