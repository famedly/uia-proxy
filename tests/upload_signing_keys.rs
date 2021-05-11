use std::collections::BTreeMap;

use famedly_e2e_testing::{
    eyre::Result, matrix_sdk, serde_json::json, tokio, url::Url, DEV_ENV_HOMESERVER,
};

#[tokio::test]
async fn test_upload_signing_keys() -> Result<()> {
    let username = "admin";
    let password = "password";
    let homeserver_url =
        Url::parse(&DEV_ENV_HOMESERVER.to_owned()).expect("Couldn't parse the homeserver URL");
    let client = matrix_sdk::Client::new(homeserver_url).unwrap();

    let response = client.login(username, password, None, None).await?;

    let user_id = &response.user_id;

    client
        .sync_once(matrix_sdk::SyncSettings::default())
        .await?;

    if let Err(e) = client.bootstrap_cross_signing(None).await {
        if let Some(response) = e.uiaa_response() {
            let auth_data = auth_data(&user_id, &password, response.session.as_deref());
            client
                .bootstrap_cross_signing(Some(auth_data))
                .await
                .expect("Couldn't bootstrap cross signing")
        } else {
            panic!("Error durign cross signing bootstrap {:#?}", e);
        }
    }

    Ok(())
}

fn auth_data<'a>(
    user: &matrix_sdk::identifiers::UserId,
    password: &str,
    session: Option<&'a str>,
) -> matrix_sdk::api::r0::uiaa::AuthData<'a> {
    let mut auth_parameters = BTreeMap::new();
    let identifier = json!({
        "type": "m.id.user",
        "user": user,
    });

    auth_parameters.insert("identifier".to_owned(), identifier);
    auth_parameters.insert("password".to_owned(), password.to_owned().into());

    matrix_sdk::api::r0::uiaa::AuthData::DirectRequest {
        kind: "m.login.password",
        auth_parameters,
        session,
    }
}
