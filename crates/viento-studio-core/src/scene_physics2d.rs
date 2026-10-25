//! Engine-independent, bounded 2D body declarations. This module owns no
//! simulation, engine handles, clock, world lookup or author source writes.
#![forbid(unsafe_code)]
use crate::CoreError;
use serde::{
    de::{MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use serde_json::Value;
use std::{collections::HashSet, fmt};

const MAX_BODIES: usize = 128;
const MAX_DOCUMENT_BYTES: usize = 65536;

fn invalid() -> CoreError {
    CoreError {
        error_code: "scene_physics2d_invalid",
        message: "Expected a complete bounded 2D physics declaration with unique bodies and scene instances.",
    }
}

// Check raw decoded keys before Value can erase duplicates, including aliases.
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
        || !text.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
    {
        return Err(invalid());
    }
    Ok(text)
}

fn bounded(value: &Value, min: f64, max: f64) -> bool {
    value
        .as_f64()
        .is_some_and(|number| number.is_finite() && number >= min && number <= max)
}

fn pair(value: &Value, min: f64, max: f64) -> bool {
    value
        .as_array()
        .is_some_and(|items| items.len() == 2 && items.iter().all(|item| bounded(item, min, max)))
}

fn bits(value: &Value) -> bool {
    bounded(value, 0.0, 65535.0) && value.as_f64().unwrap().fract() == 0.0
}

fn document(value: &Value) -> Result<Value, CoreError> {
    document_version(value, 1)
}

fn document_version(value: &Value, version: u32) -> Result<Value, CoreError> {
    if !exact(
        value,
        &["format", "schemaVersion", "sceneObjectId", "bodies"],
    ) || value["format"] != "viento-scene-physics2d"
        || value["schemaVersion"].as_f64() != Some(f64::from(version))
        || serde_json::to_vec(value).map_err(|_| invalid())?.len() > MAX_DOCUMENT_BYTES
    {
        return Err(invalid());
    }
    uuid(&value["sceneObjectId"])?;
    let bodies = value["bodies"].as_array().ok_or_else(invalid)?;
    if bodies.is_empty() || bodies.len() > MAX_BODIES {
        return Err(invalid());
    }
    let mut ids = HashSet::new();
    let mut instances = HashSet::new();
    for body in bodies {
        let mut keys = vec![
            "id",
            "instanceId",
            "kind",
            "shape",
            "offset",
            "layer",
            "mask",
        ];
        if version == 2 && body.get("collisionResponse").is_some() {
            if body["kind"] != "character"
                || !matches!(body["collisionResponse"].as_str(), Some("stop" | "slide"))
            {
                return Err(invalid());
            }
            keys.push("collisionResponse");
        }
        if !exact(body, &keys)
            || !matches!(
                body["kind"].as_str(),
                Some("static" | "character" | "sensor")
            )
            || !pair(&body["offset"], -8192.0, 8192.0)
            || !bits(&body["layer"])
            || !bits(&body["mask"])
            || !ids.insert(uuid(&body["id"])?)
            || !instances.insert(uuid(&body["instanceId"])?)
        {
            return Err(invalid());
        }
        let shape = &body["shape"];
        let valid = match shape["kind"].as_str() {
            Some("box") => exact(shape, &["kind", "size"]) && pair(&shape["size"], 1.0, 8192.0),
            Some("circle") => {
                exact(shape, &["kind", "radius"]) && bounded(&shape["radius"], 0.5, 4096.0)
            }
            _ => false,
        };
        if !valid {
            return Err(invalid());
        }
    }
    // Preserve author order and every value; adapters own engine representation.
    Ok(value.clone())
}

#[derive(Debug, Serialize)]
pub struct ScenePhysics2DResponse {
    document: Value,
}

pub(crate) fn dispatch(request: &Value) -> Result<ScenePhysics2DResponse, CoreError> {
    if !exact(request, &["protocolVersion", "operation", "document"])
        || request["protocolVersion"].as_f64() != Some(1.0)
        || !matches!(
            request["operation"].as_str(),
            Some("scenePhysics2D.inspect" | "scenePhysics2D.inspectResponse")
        )
    {
        return Err(CoreError::request());
    }
    Ok(ScenePhysics2DResponse {
        document: if request["operation"] == "scenePhysics2D.inspectResponse" {
            document_version(&request["document"], 2)?
        } else {
            document(&request["document"])?
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn id(n: usize) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }
    fn body(n: usize, kind: &str) -> Value {
        json!({"id":id(n),"instanceId":id(1000+n),"kind":kind,
            "shape":{"kind":"box","size":[32,48]},"offset":[0,0],"layer":1,"mask":2})
    }
    fn doc() -> Value {
        json!({"format":"viento-scene-physics2d","schemaVersion":1,"sceneObjectId":id(900),
            "bodies":[body(1,"static"),body(2,"character"),body(3,"sensor")]})
    }
    fn request(document: Value) -> Value {
        json!({"protocolVersion":1,"operation":"scenePhysics2D.inspect","document":document})
    }
    fn wire(value: Value) -> Value {
        serde_json::from_slice(&crate::dispatch_json(&serde_json::to_vec(&value).unwrap())).unwrap()
    }

    #[test]
    fn all_kinds_shapes_and_order_survive_without_engine_state() {
        assert_eq!(crate::viento_core_scene_physics2d_version(), 1);
        let mut value = doc();
        value["bodies"][1]["shape"] = json!({"kind":"circle","radius":16});
        let result = wire(request(value.clone()));
        assert_eq!(
            result,
            json!({"protocolVersion":1,"ok":true,"scenePhysics2D":{"document":value}})
        );
    }

    #[test]
    fn exact_documents_bodies_and_shapes_reject_unknown_or_missing_fields() {
        for pointer in ["", "/bodies/0", "/bodies/0/shape"] {
            let original = doc();
            let keys: Vec<String> = original
                .pointer(pointer)
                .unwrap()
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect();
            for key in keys {
                let mut value = original.clone();
                value
                    .pointer_mut(pointer)
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .remove(&key);
                assert!(document(&value).is_err(), "{pointer}/{key}");
            }
            let mut value = original;
            value.pointer_mut(pointer).unwrap()["extra"] = json!(true);
            assert!(document(&value).is_err());
        }
        let mut value = doc();
        value["bodies"][0]["shape"] = json!({"kind":"circle","radius":1,"size":[1,1]});
        assert!(document(&value).is_err());
    }

    #[test]
    fn numeric_boundaries_are_inclusive_and_masks_are_sixteen_bit_integers() {
        let mut value = doc();
        value["bodies"][0]["shape"]["size"] = json!([1, 8192]);
        value["bodies"][0]["offset"] = json!([-8192, 8192]);
        value["bodies"][0]["layer"] = json!(0);
        value["bodies"][0]["mask"] = json!(65535);
        assert!(document(&value).is_ok());
        for radius in [0.5, 4096.0] {
            value["bodies"][0]["shape"] = json!({"kind":"circle","radius":radius});
            assert!(document(&value).is_ok());
        }
        for (pointer, bad) in [
            ("/bodies/0/shape", json!({"kind":"rect","size":[1,1]})),
            ("/bodies/0/shape", json!({"kind":"box","size":[0.99,1]})),
            ("/bodies/0/shape", json!({"kind":"box","size":[1,8192.01]})),
            ("/bodies/0/shape", json!({"kind":"circle","radius":0.49})),
            ("/bodies/0/shape", json!({"kind":"circle","radius":4096.01})),
            ("/bodies/0/offset", json!([0, 8192.01])),
            ("/bodies/0/offset", json!([-8192.01, 0])),
            ("/bodies/0/offset", json!([0, 0, 0])),
            ("/bodies/0/layer", json!(-1)),
            ("/bodies/0/mask", json!(65536)),
            ("/bodies/0/mask", json!(0.5)),
            ("/bodies/0/kind", json!("rigid")),
            ("/bodies/0/layer", json!("1")),
        ] {
            let mut invalid = doc();
            *invalid.pointer_mut(pointer).unwrap() = bad;
            assert!(document(&invalid).is_err(), "{pointer}");
        }
    }

    #[test]
    fn identities_and_body_count_are_bounded_without_reordering() {
        let mut value = doc();
        value["bodies"] = json!([]);
        assert!(document(&value).is_err());
        value["bodies"] = (0..128).map(|n| body(n, "static")).collect();
        assert_eq!(document(&value).unwrap(), value);
        value["bodies"]
            .as_array_mut()
            .unwrap()
            .push(body(128, "sensor"));
        assert!(document(&value).is_err());
        for pointer in ["/bodies/1/id", "/bodies/1/instanceId"] {
            let mut value = doc();
            *value.pointer_mut(pointer).unwrap() = value
                .pointer(&pointer.replace("/1/", "/0/"))
                .unwrap()
                .clone();
            assert!(document(&value).is_err());
        }
        for bad in [
            "INVALID",
            "abcdefab-1111-4111-8111-111111111111\n",
            "ABCDEFAB-1111-4111-8111-111111111111",
        ] {
            let mut value = doc();
            value["bodies"][0]["id"] = json!(bad);
            assert!(document(&value).is_err());
        }
    }

    #[test]
    fn raw_duplicate_keys_and_cross_domain_envelopes_fail() {
        let raw = serde_json::to_string(&request(doc())).unwrap();
        for (from, to) in [
            ("\"mask\":2", "\"mask\":1,\"ma\\u0073k\":2"),
            (
                "\"schemaVersion\":1",
                "\"schemaVersion\":0,\"schemaVersion\":1",
            ),
        ] {
            let result: Value =
                serde_json::from_slice(&crate::dispatch_json(raw.replace(from, to).as_bytes()))
                    .unwrap();
            assert_eq!(result["errorCode"], "studio_core_request_invalid");
        }
        let mut value = request(doc());
        value["extra"] = json!(true);
        assert!(dispatch(&value).is_err());
        value = request(doc());
        value["operation"] = json!("scenePhysics2D.sample");
        assert!(dispatch(&value).is_err());
    }

    #[test]
    fn response_schema_and_operation_are_separate_from_legacy_inspection() {
        assert_eq!(crate::viento_core_scene_physics2d_response_version(), 1);
        let mut value = doc();
        value["schemaVersion"] = json!(2);
        for response in [None, Some("stop"), Some("slide")] {
            let mut candidate = value.clone();
            if let Some(mode) = response {
                candidate["bodies"][1]["collisionResponse"] = json!(mode);
            }
            assert!(document(&candidate).is_err());
            assert_eq!(document_version(&candidate, 2).unwrap(), candidate);
            let mut input = request(candidate.clone());
            assert_eq!(wire(input.clone())["errorCode"], "scene_physics2d_invalid");
            input["operation"] = json!("scenePhysics2D.inspectResponse");
            assert_eq!(wire(input)["scenePhysics2D"]["document"], candidate);
        }
        let mut input = request(doc());
        input["operation"] = json!("scenePhysics2D.inspectResponse");
        assert_eq!(wire(input)["errorCode"], "scene_physics2d_invalid");
    }

    #[test]
    fn response_is_an_optional_character_only_exact_enum() {
        for mode in [
            json!(null),
            json!(true),
            json!(1),
            json!(""),
            json!("Slide"),
            json!("stop "),
            json!({}),
        ] {
            let mut value = doc();
            value["schemaVersion"] = json!(2);
            value["bodies"][1]["collisionResponse"] = mode;
            assert!(document_version(&value, 2).is_err());
        }
        for index in 0..3 {
            let mut value = doc();
            value["bodies"][index]["collisionResponse"] = json!("slide");
            assert!(document(&value).is_err());
            value["schemaVersion"] = json!(2);
            assert_eq!(document_version(&value, 2).is_ok(), index == 1);
        }
        let mut value = doc();
        value["schemaVersion"] = json!(2);
        value["bodies"][1]["collisionResponse"] = json!("slide");
        value["bodies"][1]["extra"] = json!(true);
        assert!(document_version(&value, 2).is_err());
    }

    #[test]
    fn response_raw_keys_and_existing_geometry_limits_remain_strict() {
        let mut value = doc();
        value["schemaVersion"] = json!(2);
        value["bodies"][1]["collisionResponse"] = json!("slide");
        let mut input = request(value.clone());
        input["operation"] = json!("scenePhysics2D.inspectResponse");
        let raw = serde_json::to_string(&input).unwrap().replace(
            "\"collisionResponse\":\"slide\"",
            "\"collisionResponse\":\"stop\",\"collisionResponse\":\"slide\"",
        );
        let result: Value = serde_json::from_slice(&crate::dispatch_json(raw.as_bytes())).unwrap();
        assert_eq!(result["errorCode"], "studio_core_request_invalid");
        value["bodies"][1]["offset"] = json!([8193, 0]);
        assert!(document_version(&value, 2).is_err());
    }
}
