//! Bounded one-level all/any event guards. Runtime adapters resolve and compare
//! leaves; this declaration capability preserves their explicit order unchanged.
#![forbid(unsafe_code)]
use crate::{
    animation_state_conditions, animation_state_selectors, animation_state_table, CoreError,
};
use serde_json::{json, Value};

fn invalid() -> CoreError {
    CoreError {
        error_code: "animation_state_table_invalid",
        message: "Expected bounded all/any event guards containing one to eight scalar conditions.",
    }
}
fn exact(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|record| {
        record.len() == keys.len() && keys.iter().all(|key| record.contains_key(*key))
    })
}
fn inspect_leaf(condition: &Value) -> Result<Value, CoreError> {
    let mut plain = condition.clone();
    let selector = plain
        .as_object_mut()
        .and_then(|record| record.remove("selector"));
    if selector
        .as_ref()
        .is_some_and(|value| !animation_state_selectors::selector_valid(value))
    {
        return Err(invalid());
    }
    // The old exact scalar record rejects nested groups and unknown fields.
    let mut result = animation_state_conditions::inspect(&plain).map_err(|_| invalid())?;
    if let Some(selector) = selector {
        result["selector"] = selector;
    }
    Ok(result)
}
fn inspect_condition(condition: &Value) -> Result<Value, CoreError> {
    if condition.get("combine").is_none() && condition.get("conditions").is_none() {
        return inspect_leaf(condition);
    }
    if !exact(condition, &["combine", "conditions"])
        || !matches!(condition["combine"].as_str(), Some("all" | "any"))
    {
        return Err(invalid());
    }
    let leaves = condition["conditions"].as_array().ok_or_else(invalid)?;
    if leaves.is_empty() || leaves.len() > 8 {
        return Err(invalid());
    }
    let leaves = leaves
        .iter()
        .map(inspect_leaf)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({"combine":condition["combine"],"conditions":leaves}))
}
fn declaration_bytes(table: &Value) -> Result<usize, CoreError> {
    // Legacy scalar constants already reserve 32 bytes. Include every number
    // inside each explicit group too, before replacing guards for admission.
    let mut bytes = animation_state_conditions::declaration_bytes(table)?;
    if let Some(transitions) = table.get("transitions").and_then(Value::as_array) {
        for edge in transitions {
            if let Some(leaves) = edge
                .get("trigger")
                .and_then(|value| value.get("condition"))
                .and_then(|value| value.get("conditions"))
                .and_then(Value::as_array)
            {
                for leaf in leaves {
                    if let Some(value) = leaf.get("value").filter(|value| value.is_number()) {
                        bytes =
                            bytes - serde_json::to_vec(value).map_err(|_| invalid())?.len() + 32;
                    }
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
        || request["operation"] != "animationStateTable.inspectCombined"
    {
        return Err(CoreError::request());
    }
    let table = &request["table"];
    if declaration_bytes(table)? > 32768 {
        return Err(invalid());
    }
    let mut plain = table.clone();
    let mut conditions = Vec::new();
    if let Some(transitions) = plain.get_mut("transitions").and_then(Value::as_array_mut) {
        for (index, edge) in transitions.iter_mut().enumerate() {
            if let Some(trigger) = edge.get_mut("trigger").and_then(Value::as_object_mut) {
                if let Some(condition) = trigger.get_mut("condition") {
                    let normalized = inspect_condition(condition)?;
                    // Retain a condition at every guarded edge so firstMatch
                    // fallback admission cannot mistake a group for a fallback.
                    *condition = normalized
                        .get("conditions")
                        .and_then(Value::as_array)
                        .map(|leaves| leaves[0].clone())
                        .unwrap_or_else(|| normalized.clone());
                    conditions.push((index, normalized));
                }
            }
        }
    }
    // This is internal reuse, independent of the optional selector host marker.
    let mut result = animation_state_selectors::dispatch_table(
        &json!({"protocolVersion":1,"operation":"animationStateTable.inspectSelected","table":plain}),
    )?;
    for (index, condition) in conditions {
        result.table["transitions"][index]["trigger"]["condition"] = condition.clone();
        result.transitions[index].trigger["condition"] = condition;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn leaf() -> Value {
        json!({"type":"boolean","operator":"eq","value":true})
    }
    fn table() -> Value {
        json!({"initialState":"idle","states":[{"key":"idle"},{"key":"run"}],"transitions":[
            {"from":"idle","to":"run","trigger":{"kind":"event","name":"go","condition":{"combine":"all","conditions":[leaf(),{"type":"number","operator":"gte","value":0.5,"selector":{"kind":"projectState","key":"combat.speed"}}]}}},
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
        run(value, "animationStateTable.inspectCombined")
    }
    #[test]
    fn groups_preserve_order_duplicates_singletons_and_original_indices() {
        for combine in ["all", "any"] {
            for count in [1, 2, 8] {
                let mut value = table();
                value["transitions"][0]["trigger"]["condition"] =
                    json!({"combine":combine,"conditions":vec![leaf();count]});
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
            }
        }
        assert_eq!(crate::viento_core_animation_state_combinations_version(), 1);
    }
    #[test]
    fn group_shape_and_each_leaf_are_strict_even_when_shadowed_or_redundant() {
        for condition in [
            json!({"combine":"all","conditions":[]}),
            json!({"combine":"any","conditions":vec![leaf();9]}),
            json!({"combine":"none","conditions":[leaf()]}),
            json!({"combine":"all"}),
            json!({"conditions":[leaf()]}),
            json!({"combine":"all","conditions":[leaf()],"selector":{"kind":"projectState","key":"x"}}),
            json!({"combine":"all","conditions":[leaf(),{"combine":"any","conditions":[leaf()]}]}),
            json!({"combine":"any","conditions":[leaf(),null]}),
            json!({"combine":"all","conditions":true}),
        ] {
            let mut value = table();
            value["transitions"][0]["trigger"]["condition"] = condition;
            assert_eq!(inspect(value)["errorCode"], "animation_state_table_invalid");
        }
        for bad in [
            json!({"type":"number","operator":"eq","value":"1"}),
            json!({"type":"boolean","operator":"lt","value":true}),
            json!({"type":"boolean","operator":"eq","value":true,"selector":{"kind":"projectState","key":"constructor"}}),
        ] {
            let mut value = table();
            value["transitions"][0]["trigger"]["condition"]["conditions"][1] = bad;
            assert_eq!(inspect(value)["errorCode"], "animation_state_table_invalid");
        }
    }
    #[test]
    fn only_event_guards_and_explicit_final_fallbacks_keep_existing_branch_rules() {
        let mut value = table();
        value["eventSelection"] = json!("firstMatch");
        let repeated = value["transitions"][0].clone();
        value["transitions"].as_array_mut().unwrap().push(repeated);
        assert_eq!(inspect(value.clone())["ok"], true);
        value["transitions"]
            .as_array_mut()
            .unwrap()
            .push(json!({"from":"idle","to":"idle","trigger":{"kind":"event","name":"go"}}));
        assert_eq!(inspect(value.clone())["ok"], true);
        let repeated = value["transitions"][0].clone();
        value["transitions"].as_array_mut().unwrap().push(repeated);
        assert_eq!(inspect(value)["errorCode"], "animation_state_table_invalid");
        let mut value = table();
        value["transitions"][1]["trigger"]["condition"] =
            value["transitions"][0]["trigger"]["condition"].clone();
        assert_eq!(inspect(value)["errorCode"], "animation_state_table_invalid");
    }
    #[test]
    fn old_operations_reject_groups_while_new_capability_also_admits_legacy_leaves() {
        for operation in [
            "animationStateTable.inspect",
            "animationStateTable.inspectConditional",
            "animationStateTable.inspectSelected",
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
        value["transitions"][0]["trigger"]["condition"] = leaf();
        assert_eq!(
            inspect(value.clone())["animationStateTable"],
            run(value, "animationStateTable.inspectSelected")["animationStateTable"]
        );
    }
    #[test]
    fn group_normalization_and_full_numeric_budget_cover_every_leaf() {
        let mut value = table();
        value["transitions"][0]["trigger"]["condition"]["conditions"][1]["value"] = json!(-0.0);
        let literal = serde_json::to_vec(&value).unwrap().len();
        assert_eq!(declaration_bytes(&value).unwrap(), literal - 4 + 32);
        let result = inspect(value);
        assert_eq!(
            result["animationStateTable"]["table"]["transitions"][0]["trigger"]["condition"]
                ["conditions"][1]["value"],
            json!(0)
        );
    }
    #[test]
    fn raw_group_duplicate_keys_are_refused_before_deserialization_can_hide_them() {
        let raw = serde_json::to_string(&json!({"protocolVersion":1,"operation":"animationStateTable.inspectCombined","table":table()})).unwrap();
        for (from, to) in [
            ("\"combine\":", "\"combine\":null,\"combi\\u006ee\":"),
            ("\"conditions\":", "\"conditions\":[],\"conditions\":"),
        ] {
            let result =
                serde_json::to_value(crate::dispatch(raw.replacen(from, to, 1).as_bytes()))
                    .unwrap();
            assert_eq!(result["errorCode"], "studio_core_request_invalid");
        }
        assert_eq!(inspect(table())["ok"], true);
    }
}
