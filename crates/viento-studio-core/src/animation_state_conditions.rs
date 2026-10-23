//! Optional bounded event-payload predicates. Rust owns admission and exact
//! scalar comparison; this module has no event bus, runtime or source authority.
#![forbid(unsafe_code)]
use crate::{animation_state_table, CoreError};
use serde::Serialize;
use serde_json::{json, Value};

const MAX_TABLE_BYTES: usize = 32768;
const MAX_STRING_BYTES: usize = 4096;
const MAX_NUMBER: f64 = 1_000_000_000.0;
fn invalid() -> CoreError {
    CoreError {
        error_code: "animation_state_condition_invalid",
        message: "Expected a bounded typed event-payload comparison.",
    }
}
fn table_invalid() -> CoreError {
    CoreError {
        error_code: "animation_state_table_invalid",
        message: "Expected a bounded animation state table with event-only conditions.",
    }
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|record| {
        record.len() == keys.len() && keys.iter().all(|key| record.contains_key(*key))
    })
}
fn scalar(value: &Value) -> Result<Value, CoreError> {
    match value {
        Value::Bool(_) => Ok(value.clone()),
        Value::String(text) if text.len() <= MAX_STRING_BYTES => Ok(value.clone()),
        Value::Number(number) => {
            let number = number.as_f64().ok_or_else(invalid)?;
            if !number.is_finite() || number.abs() > MAX_NUMBER {
                return Err(invalid());
            }
            Ok(if number == 0.0 {
                json!(0)
            } else {
                value.clone()
            })
        }
        _ => Err(invalid()),
    }
}
fn category(value: &Value) -> Option<&'static str> {
    match value {
        Value::Bool(_) => Some("boolean"),
        Value::String(_) => Some("string"),
        Value::Number(_) => Some("number"),
        _ => None,
    }
}
fn inspect(condition: &Value) -> Result<Value, CoreError> {
    if !exact(condition, &["type", "operator", "value"]) {
        return Err(invalid());
    }
    let value = scalar(&condition["value"])?;
    let kind = category(&value).ok_or_else(invalid)?;
    if condition["type"].as_str() != Some(kind) {
        return Err(invalid());
    }
    let operator = condition["operator"].as_str().ok_or_else(invalid)?;
    if !matches!(operator, "eq" | "ne")
        && !(kind == "number" && matches!(operator, "lt" | "lte" | "gt" | "gte"))
    {
        return Err(invalid());
    }
    Ok(json!({"type": kind, "operator": operator, "value": value}))
}
fn compare(condition: &Value, value: &Value) -> bool {
    // Type mismatch is a non-match for every operator, including ne. Boolean
    // values are never coerced into numeric values or printable strings.
    if category(value) != condition["type"].as_str() {
        return false;
    }
    let target = &condition["value"];
    let operator = condition["operator"].as_str().unwrap();
    if let (Some(first), Some(second)) = (value.as_f64(), target.as_f64()) {
        return match operator {
            "eq" => first == second,
            "ne" => first != second,
            "lt" => first < second,
            "lte" => first <= second,
            "gt" => first > second,
            "gte" => first >= second,
            _ => false,
        };
    }
    if operator == "eq" {
        value == target
    } else {
        value != target
    }
}
#[derive(Debug, Serialize)]
pub struct AnimationStateConditionResponse {
    condition: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    matches: Option<bool>,
}
pub(crate) fn dispatch_condition(
    request: &Value,
) -> Result<AnimationStateConditionResponse, CoreError> {
    let evaluate = match request["operation"].as_str() {
        Some("animationStateCondition.inspect") => false,
        Some("animationStateCondition.evaluate") => true,
        _ => return Err(CoreError::request()),
    };
    let keys: &[&str] = if evaluate {
        &["protocolVersion", "operation", "condition", "value"]
    } else {
        &["protocolVersion", "operation", "condition"]
    };
    if !exact(request, keys) || request["protocolVersion"].as_u64() != Some(1) {
        return Err(CoreError::request());
    }
    let condition = inspect(&request["condition"])?;
    if !evaluate {
        return Ok(AnimationStateConditionResponse {
            condition,
            value: None,
            matches: None,
        });
    }
    let value = scalar(&request["value"])?;
    let matches = compare(&condition, &value);
    Ok(AnimationStateConditionResponse {
        condition,
        value: Some(value),
        matches: Some(matches),
    })
}
// Reserve a fixed conservative 32 bytes for each numeric condition constant.
// This budget is specific to inspectConditional: Rust and JS serializers may
// spell the same small number as decimal or exponent text of different lengths.
fn declaration_bytes(table: &Value) -> Result<usize, CoreError> {
    let mut bytes = serde_json::to_vec(table)
        .map_err(|_| table_invalid())?
        .len();
    if let Some(transitions) = table.get("transitions").and_then(Value::as_array) {
        for transition in transitions {
            if let Some(value) = transition
                .get("trigger")
                .and_then(|value| value.get("condition"))
                .and_then(|value| value.get("value"))
            {
                if value.is_number() {
                    let literal = serde_json::to_vec(value)
                        .map_err(|_| table_invalid())?
                        .len();
                    bytes = bytes - literal + 32;
                }
            }
        }
    }
    Ok(bytes)
}

pub(crate) fn dispatch_table(
    request: &Value,
) -> Result<animation_state_table::AnimationStateTableResponse, CoreError> {
    if !exact(request, &["protocolVersion", "operation", "table"])
        || request["protocolVersion"].as_u64() != Some(1)
        || request["operation"] != "animationStateTable.inspectConditional"
    {
        return Err(CoreError::request());
    }
    let table = &request["table"];
    if declaration_bytes(table)? > MAX_TABLE_BYTES {
        return Err(table_invalid());
    }
    let mut plain = table.clone();
    let mut conditions = Vec::new();
    if let Some(transitions) = plain.get_mut("transitions").and_then(Value::as_array_mut) {
        for (index, transition) in transitions.iter_mut().enumerate() {
            if let Some(trigger) = transition.get_mut("trigger").and_then(Value::as_object_mut) {
                if let Some(condition) = trigger.remove("condition") {
                    if trigger.get("kind").and_then(Value::as_str) != Some("event") {
                        return Err(table_invalid());
                    }
                    conditions.push((index, inspect(&condition).map_err(|_| table_invalid())?));
                }
            }
        }
    }
    // The legacy inspector still owns states, names, references, order and
    // uniqueness. In particular, predicates never permit branch priorities.
    let mut inspected = animation_state_table::inspect(&plain)?;
    for (index, condition) in conditions {
        inspected.table["transitions"][index]["trigger"]["condition"] = condition.clone();
        inspected.transitions[index].trigger["condition"] = condition;
    }
    Ok(inspected)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn evaluate(condition: Value, value: Value) -> Value {
        serde_json::to_value(crate::dispatch(&serde_json::to_vec(&json!({"protocolVersion":1,"operation":"animationStateCondition.evaluate","condition":condition,"value":value})).unwrap())).unwrap()
    }
    fn condition(kind: &str, operator: &str, value: Value) -> Value {
        json!({"type":kind,"operator":operator,"value":value})
    }
    fn table() -> Value {
        json!({"initialState":"idle","states":[{"key":"idle"},{"key":"action"},{"key":"isolated"}],"transitions":[
        {"from":"idle","to":"action","trigger":{"kind":"event","name":"go","condition":{"type":"number","operator":"gte","value":0.5}}},
        {"from":"action","to":"idle","trigger":{"kind":"completed"}}]})
    }
    fn inspect_table(value: Value, operation: &str) -> Value {
        serde_json::to_value(crate::dispatch(
            &serde_json::to_vec(&json!({"protocolVersion":1,"operation":operation,"table":value}))
                .unwrap(),
        ))
        .unwrap()
    }
    #[test]
    fn typed_comparisons_do_not_coerce_or_invert_mismatches() {
        for (kind, value, other) in [
            ("boolean", json!(true), json!(false)),
            ("string", json!("a"), json!("b")),
            ("number", json!(0.5), json!(0.75)),
        ] {
            for op in ["eq", "ne"] {
                let c = condition(kind, op, value.clone());
                assert_eq!(
                    evaluate(c.clone(), value.clone())["animationStateCondition"]["matches"],
                    json!(op == "eq")
                );
                assert_eq!(
                    evaluate(c.clone(), other.clone())["animationStateCondition"]["matches"],
                    json!(op == "ne")
                );
                for mismatch in [json!(true), json!("a"), json!(0.5)] {
                    if category(&mismatch) != Some(kind) {
                        assert_eq!(
                            evaluate(c.clone(), mismatch)["animationStateCondition"]["matches"],
                            false
                        );
                    }
                }
            }
        }
    }
    #[test]
    fn numbers_use_exact_double_precision_and_normalized_zero() {
        let fraction = 0.12345678901234567_f64;
        let previous = f64::from_bits(fraction.to_bits() - 1);
        let next = f64::from_bits(fraction.to_bits() + 1);
        for (operator, low, equal, high) in [
            ("eq", false, true, false),
            ("ne", true, false, true),
            ("lt", true, false, false),
            ("lte", true, true, false),
            ("gt", false, false, true),
            ("gte", false, true, true),
        ] {
            for (value, want) in [(previous, low), (fraction, equal), (next, high)] {
                assert_eq!(
                    evaluate(condition("number", operator, json!(fraction)), json!(value))
                        ["animationStateCondition"]["matches"],
                    want
                );
            }
        }
        for number in [
            f64::from_bits(1),
            -f64::from_bits(1),
            1e-7,
            1e9,
            -1e9,
            0.0000010000000000000002,
            -0.0000010000000000000002,
        ] {
            assert_eq!(
                evaluate(condition("number", "eq", json!(number)), json!(number))
                    ["animationStateCondition"]["matches"],
                true
            );
        }
        let zero = evaluate(condition("number", "eq", json!(-0.0)), json!(0.0));
        assert_eq!(zero["animationStateCondition"]["matches"], true);
        assert_eq!(
            zero["animationStateCondition"]["condition"]["value"],
            json!(0)
        );
        assert_eq!(zero["animationStateCondition"]["value"], json!(0));
    }
    #[test]
    fn scalar_and_operator_boundaries_are_strict() {
        for bad in [
            Value::Null,
            json!([]),
            json!({}),
            json!(1_000_000_001.0),
            json!("🔑".repeat(1025)),
        ] {
            assert_eq!(
                evaluate(condition("number", "eq", json!(1)), bad)["errorCode"],
                "animation_state_condition_invalid"
            );
        }
        for bad in [
            json!({}),
            json!({"type":"boolean","operator":"gt","value":true}),
            json!({"type":"string","operator":"lt","value":"a"}),
            json!({"type":"number","operator":"eq","value":"1"}),
            json!({"type":"number","operator":"EQ","value":1}),
            json!({"type":"number","operator":"eq","value":1,"extra":true}),
            json!({"type":"unknown","operator":"eq","value":true}),
        ] {
            assert_eq!(
                evaluate(bad, json!(1))["errorCode"],
                "animation_state_condition_invalid"
            );
        }
        for text in [
            String::new(),
            "🔑".repeat(1024),
            "\0\n\"\\e\u{301}".to_owned(),
        ] {
            assert_eq!(
                evaluate(condition("string", "eq", json!(text)), json!(text))
                    ["animationStateCondition"]["matches"],
                true
            );
        }
    }
    #[test]
    fn conditional_tables_reuse_legacy_indices_and_unique_triggers() {
        let source = table();
        let inspected = inspect_table(source.clone(), "animationStateTable.inspectConditional");
        assert_eq!(inspected["ok"], true);
        assert_eq!(inspected["animationStateTable"]["table"], source);
        assert_eq!(
            inspected["animationStateTable"]["transitions"][0]["trigger"]["condition"]["operator"],
            "gte"
        );
        assert_eq!(inspected["animationStateTable"]["initialIndex"], 0);
        assert_eq!(
            inspect_table(table(), "animationStateTable.inspect")["errorCode"],
            "animation_state_table_invalid"
        );
        let mut duplicate = table();
        let mut edge = duplicate["transitions"][0].clone();
        edge["trigger"]["condition"]["value"] = json!(0.75);
        duplicate["transitions"].as_array_mut().unwrap().push(edge);
        assert_eq!(
            inspect_table(duplicate, "animationStateTable.inspectConditional")["errorCode"],
            "animation_state_table_invalid"
        );
        let mut completed = table();
        completed["transitions"][1]["trigger"]["condition"] =
            condition("boolean", "eq", json!(true));
        assert_eq!(
            inspect_table(completed, "animationStateTable.inspectConditional")["errorCode"],
            "animation_state_table_invalid"
        );
        let mut absent = table();
        absent["transitions"][0]["trigger"]
            .as_object_mut()
            .unwrap()
            .remove("condition");
        assert_eq!(
            inspect_table(absent.clone(), "animationStateTable.inspectConditional"),
            inspect_table(absent, "animationStateTable.inspect")
        );
    }
    #[test]
    fn original_table_budget_includes_conditions() {
        let mut value = table();
        value["transitions"]=json!((0..9).map(|index|json!({"from":"idle","to":"action","trigger":{"kind":"event","name":format!("event{index}"),"condition":{"type":"string","operator":"eq","value":"x".repeat(4096)}}})).collect::<Vec<_>>());
        assert_eq!(
            inspect_table(value, "animationStateTable.inspectConditional")["errorCode"],
            "animation_state_table_invalid"
        );
    }
    #[test]
    fn duplicate_keys_envelopes_unicode_and_optional_markers_are_explicit() {
        assert_eq!(crate::viento_core_animation_state_table_version(), 1);
        assert_eq!(crate::viento_core_animation_state_conditions_version(), 1);
        let raw = r#"{"protocolVersion":1,"operation":"animationStateCondition.evaluate","condition":{"type":"number","operator":"eq","value":1,"value":2},"value":1}"#;
        assert_eq!(
            serde_json::to_value(crate::dispatch(raw.as_bytes())).unwrap()["errorCode"],
            "studio_core_request_invalid"
        );
        let raw = r#"{"protocolVersion":1,"operation":"animationStateCondition.inspect","condition":{"type":"string","operator":"eq","value":"\uD800"}}"#;
        assert_eq!(
            serde_json::to_value(crate::dispatch(raw.as_bytes())).unwrap()["errorCode"],
            "studio_core_request_invalid"
        );
        for request in [
            json!({"protocolVersion":2,"operation":"animationStateCondition.inspect","condition":condition("number","eq",json!(1))}),
            json!({"protocolVersion":1,"operation":"animationStateCondition.inspect","condition":condition("number","eq",json!(1)),"value":1}),
            json!({"protocolVersion":1,"operation":"animationStateCondition.evaluate","condition":condition("number","eq",json!(1))}),
        ] {
            assert_eq!(
                serde_json::to_value(crate::dispatch(&serde_json::to_vec(&request).unwrap()))
                    .unwrap()["errorCode"],
                "studio_core_request_invalid"
            );
        }
    }
}
