use std::collections::BTreeMap;

use famedly_e2e_testing::{
    assert_matches::assert_matches,
    eyre::{eyre, Result},
    matrix_sdk,
    serde_json::json,
    tokio,
    uuid::Uuid,
    AdminApiClient, DEV_ENV_HOMESERVER,
};

#[tokio::test]
async fn test_password_stage_invalid_creds() -> Result<()> {
    let mut admin_api = AdminApiClient::new()?;
    admin_api.login("admin", "password").await?;

    let other_name = "Other User";
    let other_username = format!("user-{}", Uuid::new_v4().to_hyphenated().to_string());
    let other_password = "other_password";
    admin_api
        .add_user(other_name, other_password, Some(&other_username))
        .await?;

    let client = matrix_sdk::Client::new(DEV_ENV_HOMESERVER)?;

    let user = "@admin:dev.famedly.local";
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
    let identifier = json!({
        "type": "m.id.user",
        "user": other_username.to_owned(),
    });

    auth_parameters.insert("identifier".to_owned(), identifier);
    auth_parameters.insert("password".to_owned(), other_password.to_owned().into());

    let auth = matrix_sdk::api::r0::uiaa::AuthData::DirectRequest {
        kind: "m.login.password",
        session: uiaa_response.session.as_deref(),
        auth_parameters,
    };

    request.auth = Some(auth);

    let err = client
        .send(request, None)
        .await
        .err()
        .ok_or_else(|| eyre!("expected error"))?;

    assert_matches!(
        err,
        matrix_sdk::Error::Http(matrix_sdk::HttpError::UiaaError(_))
    );

    Ok(())
}
