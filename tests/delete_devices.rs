use std::{collections::BTreeMap, str::FromStr};

use famedly_e2e_testing::{
    assert_matches::assert_matches,
    eyre::Result,
    matrix_sdk::{
        api::{self, r0::uiaa::AuthData},
        identifiers::UserId,
        Client,
    },
    serde_json::json,
    tokio, DEV_ENV_HOMESERVER,
};

#[tokio::test]
async fn test_delete_devices() -> Result<()> {
    let client = Client::new(DEV_ENV_HOMESERVER)?;

    let user = "@admin:dev.famedly.local";
    let password = "password";
    let device_id = "some_device";
    client.login(user, password, device_id.into(), None).await?;

    let request = api::r0::device::delete_device::Request::new(device_id.into());
    let err = client
        .send(request, None)
        .await
        .err()
        .expect("uia error expected");

    let uiaa_response = err.uiaa_response().expect("uia response expected");

    let mut request = api::r0::device::delete_device::Request::new(device_id.into());

    let mut auth_parameters = BTreeMap::new();
    let user = UserId::from_str(user)?;
    let identifier = json!({
        "type": "m.id.user",
        "user": user,
    });

    auth_parameters.insert("identifier".to_owned(), identifier);
    auth_parameters.insert("password".to_owned(), password.to_owned().into());

    let auth = AuthData::DirectRequest {
        kind: "m.login.password",
        session: uiaa_response.session.as_deref(),
        auth_parameters,
    };

    request.auth = Some(auth);

    let res = client.send(request, None).await?;

    assert_matches!(res, api::r0::device::delete_device::Response { .. });

    Ok(())
}
