use std::{collections::BTreeMap, convert::TryInto, str::FromStr};

use famedly_e2e_testing::{
    assert_matches::assert_matches, eyre::Result, matrix_sdk, serde_json::json, tokio,
    DEV_ENV_HOMESERVER,
};

#[tokio::test]
async fn test_delete_devices() -> Result<()> {
    let client = matrix_sdk::Client::new(DEV_ENV_HOMESERVER.try_into()?)?;

    let user = "@admin:ci.famedly.local";
    let password = "password";
    let device_id = "some_device";
    client.login(user, password, device_id.into(), None).await?;

    let request = matrix_sdk::api::r0::device::delete_device::Request::new(device_id.into());
    let err = client
        .send(request, None)
        .await
        .err()
        .expect("uia error expected");

    let uiaa_response = err.uiaa_response().expect("uia response expected");

    let mut request = matrix_sdk::api::r0::device::delete_device::Request::new(device_id.into());

    let mut auth_parameters = BTreeMap::new();
    let user = matrix_sdk::identifiers::UserId::from_str(user)?;
    let identifier = json!({
        "type": "m.id.user",
        "user": user,
    });

    auth_parameters.insert("identifier".to_owned(), identifier);
    auth_parameters.insert("password".to_owned(), password.to_owned().into());

    let auth = matrix_sdk::api::r0::uiaa::AuthData::DirectRequest {
        kind: "m.login.password",
        session: uiaa_response.session.as_deref(),
        auth_parameters,
    };

    request.auth = Some(auth);

    let res = client.send(request, None).await?;

    assert_matches!(
        res,
        matrix_sdk::api::r0::device::delete_device::Response { .. }
    );

    Ok(())
}
