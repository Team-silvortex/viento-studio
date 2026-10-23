//! Optional project-state selectors for event conditions. The adapter resolves
//! values at event delivery; this declaration-only capability has no state store.
#![forbid(unsafe_code)]
use crate::{
    animation_state_branches, animation_state_conditions, animation_state_table, CoreError,
};
use serde_json::{json, Value};

fn invalid() -> CoreError {
    CoreError {
        error_code: "animation_state_table_invalid",
        message: "Expected bounded event conditions with explicit project-state selectors.",
    }
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|record| {
        record.len() == keys.len() && keys.iter().all(|key| record.contains_key(*key))
    })
}
pub(crate) fn selector_valid(value: &Value) -> bool {
    if !exact(value, &["kind", "key"]) || value["kind"] != "projectState" {
        return false;
    }
    let Some(key) = value["key"].as_str() else {
        return false;
    };
    let bytes = key.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && bytes[0].is_ascii_alphabetic()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
        && !matches!(key, "constructor" | "prototype" | "__proto__")
}
pub(crate) fn dispatch_table(
    request: &Value,
) -> Result<animation_state_table::AnimationStateTableResponse, CoreError> {
    if !exact(request, &["protocolVersion", "operation", "table"])
        || request["protocolVersion"].as_u64() != Some(1)
        || request["operation"] != "animationStateTable.inspectSelected"
    {
        return Err(CoreError::request());
    }
    let table = &request["table"];
    // Count the original selectors before stripping them for legacy admission.
    if animation_state_conditions::declaration_bytes(table)? > 32768 {
        return Err(invalid());
    }
    let mut plain = table.clone();
    let mut selectors = Vec::new();
    if let Some(transitions) = plain.get_mut("transitions").and_then(Value::as_array_mut) {
        for (index, transition) in transitions.iter_mut().enumerate() {
            if let Some(condition) = transition
                .get_mut("trigger")
                .and_then(|trigger| trigger.get_mut("condition"))
                .and_then(Value::as_object_mut)
            {
                if let Some(selector) = condition.remove("selector") {
                    if !selector_valid(&selector) {
                        return Err(invalid());
                    }
                    selectors.push((index, selector));
                }
            }
        }
    }
    // Internal reuse does not require either older optional host marker. Their
    // public operations continue rejecting selectors and retain exact semantics.
    let mut result = if table.get("eventSelection").is_some() {
        animation_state_branches::dispatch_table(
            &json!({"protocolVersion":1,"operation":"animationStateTable.inspectBranches","table":plain}),
        )?
    } else {
        animation_state_conditions::dispatch_table(
            &json!({"protocolVersion":1,"operation":"animationStateTable.inspectConditional","table":plain}),
        )?
    };
    for (index, selector) in selectors {
        result.table["transitions"][index]["trigger"]["condition"]["selector"] = selector.clone();
        result.transitions[index].trigger["condition"]["selector"] = selector;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn table() -> Value {
        json!({"initialState":"idle","states":[{"key":"idle"},{"key":"run"}],"transitions":[
            {"from":"idle","to":"run","trigger":{"kind":"event","name":"go","condition":{"type":"boolean","operator":"eq","value":true,"selector":{"kind":"projectState","key":"combat.enabled"}}}},
            {"from":"run","to":"idle","trigger":{"kind":"completed"}}
        ]})
    }
    fn run(value: Value, operation: &str) -> Value {
        serde_json::to_value(crate::dispatch(
            &serde_json::to_vec(&json!({"protocolVersion":1,"operation":operation,"table":value}))
                .unwrap(),
        ))
        .unwrap()
    }
    fn inspect(value: Value) -> Value {
        run(value, "animationStateTable.inspectSelected")
    }
    #[test]
    fn preserves_selector_in_table_and_indexed_ir_with_independent_marker() {
        let value = table();
        let result = inspect(value.clone());
        assert_eq!(result["ok"], true);
        assert_eq!(result["animationStateTable"]["table"], value);
        assert_eq!(
            result["animationStateTable"]["transitions"][0]["trigger"],
            value["transitions"][0]["trigger"]
        );
        assert_eq!(
            result["animationStateTable"]["transitions"][0]["toIndex"],
            1
        );
        assert_eq!(crate::viento_core_animation_state_selectors_version(), 1);
    }
    #[test]
    fn unique_and_ordered_mixed_payload_shared_tables_keep_all_old_rules() {
        let mut value = table();
        value["eventSelection"] = json!("firstMatch");
        let mut payload = value["transitions"][0].clone();
        payload["trigger"]["condition"]
            .as_object_mut()
            .unwrap()
            .remove("selector");
        value["transitions"].as_array_mut().unwrap().push(payload);
        value["transitions"]
            .as_array_mut()
            .unwrap()
            .push(json!({"from":"idle","to":"idle","trigger":{"kind":"event","name":"go"}}));
        assert_eq!(inspect(value.clone())["ok"], true);
        let mut invalid = value.clone();
        invalid["transitions"]
            .as_array_mut()
            .unwrap()
            .push(value["transitions"][0].clone());
        assert_eq!(
            inspect(invalid)["errorCode"],
            "animation_state_table_invalid"
        );
        value.as_object_mut().unwrap().remove("eventSelection");
        assert_eq!(inspect(value)["errorCode"], "animation_state_table_invalid");
        let mut completed = table();
        completed["transitions"][1]["trigger"]["condition"] =
            completed["transitions"][0]["trigger"]["condition"].clone();
        assert_eq!(
            inspect(completed)["errorCode"],
            "animation_state_table_invalid"
        );
    }
    #[test]
    fn selectors_have_exact_shape_and_project_key_bounds() {
        for key in ["A", "combat.enabled", "a_B-9.z", &"Z".repeat(64)] {
            let mut value = table();
            value["transitions"][0]["trigger"]["condition"]["selector"]["key"] = json!(key);
            assert_eq!(inspect(value)["ok"], true, "{key}");
        }
        for key in [
            "",
            "_a",
            "9a",
            "constructor",
            "prototype",
            "__proto__",
            "a/b",
            "a\n",
            "é",
            &"Z".repeat(65),
        ] {
            let mut value = table();
            value["transitions"][0]["trigger"]["condition"]["selector"]["key"] = json!(key);
            assert_eq!(
                inspect(value)["errorCode"],
                "animation_state_table_invalid",
                "{key}"
            );
        }
        for selector in [
            Value::Null,
            json!([]),
            json!({}),
            json!({"kind":"payload"}),
            json!({"kind":"projectState","key":"ok","extra":true}),
            json!({"kind":"projectState","key":1}),
        ] {
            let mut value = table();
            value["transitions"][0]["trigger"]["condition"]["selector"] = selector;
            assert_eq!(inspect(value)["errorCode"], "animation_state_table_invalid");
        }
    }
    #[test]
    fn selectors_do_not_relax_scalar_or_condition_contracts() {
        for condition in [
            json!({"type":"number","operator":"eq","value":"1"}),
            json!({"type":"string","operator":"lt","value":""}),
            json!({"type":"number","operator":"eq","value":1000000001}),
            json!({"type":"boolean","operator":"eq","value":true,"extra":1}),
        ] {
            let mut value = table();
            value["transitions"][0]["trigger"]["condition"] = condition;
            value["transitions"][0]["trigger"]["condition"]["selector"] =
                json!({"kind":"projectState","key":"ok"});
            assert_eq!(inspect(value)["errorCode"], "animation_state_table_invalid");
        }
        let mut value = table();
        value["transitions"][0]["trigger"]["condition"] = json!({"type":"number","operator":"eq","value":-0.0,"selector":{"kind":"projectState","key":"ok"}});
        assert_eq!(
            inspect(value)["animationStateTable"]["table"]["transitions"][0]["trigger"]
                ["condition"]["value"],
            json!(0)
        );
    }
    #[test]
    fn old_operations_still_reject_selectors_and_selected_admission_accepts_plain_tables() {
        for operation in [
            "animationStateTable.inspect",
            "animationStateTable.inspectConditional",
            "animationStateTable.inspectBranches",
        ] {
            let mut value = table();
            if operation.ends_with("Branches") {
                value["eventSelection"] = json!("firstMatch");
            }
            assert_eq!(
                run(value, operation)["errorCode"],
                "animation_state_table_invalid"
            );
        }
        let mut value = table();
        value["transitions"][0]["trigger"]
            .as_object_mut()
            .unwrap()
            .remove("condition");
        assert_eq!(
            inspect(value.clone())["animationStateTable"],
            run(value, "animationStateTable.inspect")["animationStateTable"]
        );
    }
    #[test]
    fn raw_selected_requests_reject_duplicate_decoded_keys() {
        let raw = serde_json::to_string(&json!({"protocolVersion":1,"operation":"animationStateTable.inspectSelected","table":table()})).unwrap();
        for (from, to) in [
            ("\"selector\":", "\"selector\":null,\"sel\\u0065ctor\":"),
            (
                "\"key\":\"combat.enabled\"",
                "\"key\":\"other\",\"key\":\"combat.enabled\"",
            ),
        ] {
            let result =
                serde_json::to_value(crate::dispatch(raw.replacen(from, to, 1).as_bytes()))
                    .unwrap();
            assert_eq!(result["errorCode"], "studio_core_request_invalid");
        }
        assert_eq!(inspect(table())["ok"], true);
    }
}
