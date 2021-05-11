use std::{collections::BTreeMap, convert::TryInto};

use famedly_e2e_testing::{
    assert_matches::assert_matches, eyre::Result, matrix_sdk, serde_json::json, tokio, uuid::Uuid,
    AdminApiClient, DEV_ENV_HOMESERVER,
};

#[tokio::test]
async fn test_change_password() -> Result<()> {
    let mut admin_api = AdminApiClient::new()?;
    admin_api.login("admin", "password").await?;

    let name = "Random User";
    let user = format!("user-{}", Uuid::new_v4().to_hyphenated().to_string());
    let password = "password";
    admin_api.add_user(name, password, Some(&user)).await?;

    let client = matrix_sdk::Client::new(DEV_ENV_HOMESERVER)?;
    client.login(&user, password, None, None).await?;

    let new_password = "new_password";
    let request = matrix_sdk::api::r0::account::change_password::Request::new(new_password);
    let err = client
        .send(request, None)
        .await
        .err()
        .expect("uia error expected");

    let uiaa_response = err.uiaa_response().expect("uia response expected");

    let mut request = matrix_sdk::api::r0::account::change_password::Request::new(new_password);

    let mut auth_parameters = BTreeMap::new();
    let identifier = json!({
        "type": "m.id.user",
        "user": matrix_sdk::identifiers::UserId::parse_with_server_name(
            user.clone(),
            client
                .homeserver()
                .host_str()
                .expect("expected homeserver hostname")
                .try_into()?,
        )?,
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
        matrix_sdk::api::r0::account::change_password::Response { .. }
    );

    let client = matrix_sdk::Client::new(DEV_ENV_HOMESERVER)?;
    let res = client.login(&user, new_password, None, None).await?;

    assert_matches!(res, matrix_sdk::api::r0::session::login::Response { .. });

    Ok(())
}
