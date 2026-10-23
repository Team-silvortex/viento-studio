//! Bounded engine-independent animation state declarations. This module owns
//! names, references and deterministic lookup indices, never playback or code.
#![forbid(unsafe_code)]
use crate::CoreError;
use serde::{
    de::{MapAccess, SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fmt,
};

const MAX_TABLE_BYTES: usize = 32768;
fn invalid() -> CoreError {
    CoreError { error_code: "animation_state_table_invalid", message: "Expected a bounded animation state table with unique states, valid references and unambiguous triggers." }
}
// Check decoded keys before Value can erase duplicates or escaped aliases.
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
    value.as_object().is_some_and(|record| {
        record.len() == keys.len() && keys.iter().all(|key| record.contains_key(*key))
    })
}
fn state_key(value: &Value) -> Result<&str, CoreError> {
    let text = value.as_str().ok_or_else(invalid)?;
    if text.is_empty()
        || text.len() > 32
        || !text.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase() || index > 0 && (byte.is_ascii_digit() || byte == b'_')
        })
    {
        return Err(invalid());
    }
    Ok(text)
}
fn event_name(value: &Value) -> Result<&str, CoreError> {
    let text = value.as_str().ok_or_else(invalid)?;
    if text.is_empty()
        || text.len() > 64
        || matches!(text, "constructor" | "prototype" | "__proto__")
        || !text.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphabetic()
                || index > 0 && (byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-'))
        })
    {
        return Err(invalid());
    }
    Ok(text)
}
#[derive(Debug, Serialize)]
pub struct IndexedState {
    key: String,
    index: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedTransition {
    from_index: usize,
    to_index: usize,
    pub(crate) trigger: Value,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimationStateTableResponse {
    pub(crate) table: Value,
    states: Vec<IndexedState>,
    initial_index: usize,
    pub(crate) transitions: Vec<IndexedTransition>,
    pub(crate) event_names: Vec<String>,
}
pub(crate) fn inspect(table: &Value) -> Result<AnimationStateTableResponse, CoreError> {
    if !exact(table, &["initialState", "states", "transitions"])
        || serde_json::to_vec(table).map_err(|_| invalid())?.len() > MAX_TABLE_BYTES
    {
        return Err(invalid());
    }
    let source_states = table["states"].as_array().ok_or_else(invalid)?;
    let source_transitions = table["transitions"].as_array().ok_or_else(invalid)?;
    if source_states.is_empty() || source_states.len() > 16 || source_transitions.len() > 64 {
        return Err(invalid());
    }
    let mut states = Vec::with_capacity(source_states.len());
    let mut indices = HashMap::new();
    for (index, state) in source_states.iter().enumerate() {
        if !exact(state, &["key"]) {
            return Err(invalid());
        }
        let key = state_key(&state["key"])?;
        if indices.insert(key, index).is_some() {
            return Err(invalid());
        }
        states.push(IndexedState {
            key: key.to_owned(),
            index,
        });
    }
    let initial_index = *indices
        .get(state_key(&table["initialState"])?)
        .ok_or_else(invalid)?;
    let mut transitions = Vec::with_capacity(source_transitions.len());
    let mut event_names = Vec::new();
    let mut seen_events = HashSet::new();
    let mut triggers = HashSet::new();
    for transition in source_transitions {
        if !exact(transition, &["from", "to", "trigger"]) {
            return Err(invalid());
        }
        let from_index = *indices
            .get(state_key(&transition["from"])?)
            .ok_or_else(invalid)?;
        let to_index = *indices
            .get(state_key(&transition["to"])?)
            .ok_or_else(invalid)?;
        let trigger = &transition["trigger"];
        let event = match trigger["kind"].as_str() {
            Some("event") if exact(trigger, &["kind", "name"]) => {
                Some(event_name(&trigger["name"])?)
            }
            Some("completed") if exact(trigger, &["kind"]) => None,
            _ => return Err(invalid()),
        };
        if !triggers.insert((from_index, event)) {
            return Err(invalid());
        }
        if let Some(name) = event {
            if seen_events.insert(name) {
                if seen_events.len() > 32 {
                    return Err(invalid());
                }
                event_names.push(name.to_owned());
            }
        }
        transitions.push(IndexedTransition {
            from_index,
            to_index,
            trigger: trigger.clone(),
        });
    }
    Ok(AnimationStateTableResponse {
        table: table.clone(),
        states,
        initial_index,
        transitions,
        event_names,
    })
}
pub(crate) fn dispatch(request: &Value) -> Result<AnimationStateTableResponse, CoreError> {
    if !exact(request, &["protocolVersion", "operation", "table"])
        || request["protocolVersion"].as_u64() != Some(1)
        || request["operation"] != "animationStateTable.inspect"
    {
        return Err(CoreError::request());
    }
    inspect(&request["table"])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn table() -> Value {
        json!({"initialState":"idle","states":[{"key":"idle"},{"key":"attack"},{"key":"unused"}],"transitions":[
        {"from":"idle","to":"attack","trigger":{"kind":"event","name":"combat.attack"}},
        {"from":"attack","to":"attack","trigger":{"kind":"event","name":"combat.attack"}},
        {"from":"attack","to":"idle","trigger":{"kind":"completed"}}]})
    }
    fn call(table: Value) -> Value {
        wire(
            json!({"protocolVersion":1,"operation":"animationStateTable.inspect","table":table})
                .to_string()
                .as_bytes(),
        )
    }
    fn wire(bytes: &[u8]) -> Value {
        serde_json::from_slice(&crate::dispatch_json(bytes)).unwrap()
    }
    #[test]
    fn index_is_ordered_and_preserves_table_self_edges_cycles_and_unused_states() {
        let source = table();
        let value = call(source.clone());
        assert_eq!(value["ok"], true);
        let result = &value["animationStateTable"];
        assert_eq!(result["table"], source);
        assert_eq!(result["initialIndex"], 0);
        assert_eq!(
            result["states"],
            json!([{"key":"idle","index":0},{"key":"attack","index":1},{"key":"unused","index":2}])
        );
        assert_eq!(result["eventNames"], json!(["combat.attack"]));
        assert_eq!(
            result["transitions"][2],
            json!({"fromIndex":1,"toIndex":0,"trigger":{"kind":"completed"}})
        );
        let mut minimal = table();
        minimal["states"] = json!([{"key":"idle"}]);
        minimal["transitions"] = json!([]);
        assert_eq!(call(minimal)["ok"], true);
    }
    #[test]
    fn references_duplicates_and_trigger_shapes_are_strict() {
        let mut cases = Vec::new();
        let mut t = table();
        t["initialState"] = json!("missing");
        cases.push(t);
        let mut t = table();
        t["states"][1]["key"] = json!("idle");
        cases.push(t);
        let mut t = table();
        t["states"] = json!([]);
        cases.push(t);
        for key in ["from", "to"] {
            let mut t = table();
            t["transitions"][0][key] = json!("missing");
            cases.push(t);
        }
        for trigger in [
            json!({"kind":"completed","name":"x"}),
            json!({"kind":"event"}),
            json!({"kind":"other"}),
            Value::Null,
            json!([]),
        ] {
            let mut t = table();
            t["transitions"][0]["trigger"] = trigger;
            cases.push(t);
        }
        let mut t = table();
        let duplicate = t["transitions"][0].clone();
        t["transitions"].as_array_mut().unwrap().push(duplicate);
        cases.push(t);
        let mut t = table();
        t["transitions"]
            .as_array_mut()
            .unwrap()
            .push(json!({"from":"attack","to":"unused","trigger":{"kind":"completed"}}));
        cases.push(t);
        for t in cases {
            assert_eq!(call(t)["errorCode"], "animation_state_table_invalid");
        }
    }
    #[test]
    fn names_never_trim_coerce_or_escape_into_another_namespace() {
        for key in [
            "",
            "Idle",
            "idle ",
            "_idle",
            "1idle",
            "idle-x",
            "待机",
            "a\n",
            "a.b",
            &"a".repeat(33),
        ] {
            let mut t = table();
            t["states"][0]["key"] = json!(key);
            assert_eq!(call(t)["errorCode"], "animation_state_table_invalid");
        }
        for name in [
            "",
            " hello",
            "hello ",
            "_hello",
            "1hello",
            "constructor",
            "prototype",
            "__proto__",
            "x\n",
            "事件",
            "a\"b",
            &"a".repeat(65),
        ] {
            let mut t = table();
            t["transitions"][0]["trigger"]["name"] = json!(name);
            assert_eq!(call(t)["errorCode"], "animation_state_table_invalid");
        }
        for name in ["A", "combat.attack-now_2", &"a".repeat(64)] {
            let mut t = table();
            t["transitions"][0]["trigger"]["name"] = json!(name);
            assert_eq!(call(t)["ok"], true);
        }
        for bad in [Value::Null, json!(0), json!(false), json!([]), json!({})] {
            let mut t = table();
            t["states"][0]["key"] = bad;
            assert_eq!(call(t)["errorCode"], "animation_state_table_invalid");
        }
    }
    #[test]
    fn counts_and_distinct_event_budget_accept_exact_limits_only() {
        let mut t = table();
        t["states"] = (0..16).map(|i| json!({"key":format!("s{i}")})).collect();
        t["initialState"] = json!("s15");
        t["transitions"]=(0..64).map(|i|json!({"from":format!("s{}",i/32),"to":"s15","trigger":{"kind":"event","name":format!("Event{}",i%32)}})).collect();
        let result = call(t.clone());
        assert_eq!(result["ok"], true);
        assert_eq!(result["animationStateTable"]["initialIndex"], 15);
        assert_eq!(
            result["animationStateTable"]["eventNames"]
                .as_array()
                .unwrap()
                .len(),
            32
        );
        let mut over = t.clone();
        over["states"]
            .as_array_mut()
            .unwrap()
            .push(json!({"key":"s16"}));
        assert_eq!(call(over)["errorCode"], "animation_state_table_invalid");
        let mut over = t.clone();
        over["transitions"]
            .as_array_mut()
            .unwrap()
            .push(json!({"from":"s15","to":"s15","trigger":{"kind":"completed"}}));
        assert_eq!(call(over)["errorCode"], "animation_state_table_invalid");
        t["transitions"][63]["trigger"]["name"] = json!("Event32");
        assert_eq!(call(t)["errorCode"], "animation_state_table_invalid");
    }
    #[test]
    fn exact_records_bytes_and_duplicate_decoded_keys_are_checked() {
        for path in [
            vec![],
            vec!["states", "0"],
            vec!["transitions", "0"],
            vec!["transitions", "0", "trigger"],
        ] {
            let mut t = table();
            let mut value = &mut t;
            for part in path {
                value = if let Ok(i) = part.parse::<usize>() {
                    &mut value[i]
                } else {
                    &mut value[part]
                };
            }
            value["extra"] = json!(true);
            assert_eq!(call(t)["errorCode"], "animation_state_table_invalid");
        }
        let request =
            json!({"protocolVersion":1,"operation":"animationStateTable.inspect","table":table()});
        for key in ["protocolVersion", "operation", "table"] {
            let mut r = request.clone();
            r.as_object_mut().unwrap().remove(key);
            assert_eq!(
                wire(r.to_string().as_bytes())["errorCode"],
                "studio_core_request_invalid"
            );
        }
        for (from, to) in [
            ("\"key\":", "\"key\":null,\"key\":"),
            ("\"name\":", "\"name\":null,\"na\\u006de\":"),
            (
                "\"initialState\":",
                "\"initialState\":null,\"initialState\":",
            ),
            ("\"operation\":", "\"operation\":null,\"operation\":"),
        ] {
            assert_eq!(
                wire(request.to_string().replacen(from, to, 1).as_bytes())["errorCode"],
                "studio_core_request_invalid"
            );
        }
        let mut huge = table();
        huge["initialState"] = json!("a".repeat(MAX_TABLE_BYTES));
        assert_eq!(call(huge)["errorCode"], "animation_state_table_invalid");
        assert_eq!(
            wire(&vec![b' '; crate::MAX_INPUT_BYTES + 1])["errorCode"],
            "studio_core_input_limit"
        );
        assert_eq!(call(table())["ok"], true);
    }
}
