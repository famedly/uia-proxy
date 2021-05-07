use std::convert::TryFrom;

use famedly_e2e_testing::{
    eyre::Result,
    matrix_sdk::{api::r0 as api, OutgoingRequest, SendAccessToken},
    reqwest::{self, StatusCode}, http,
    tokio, DEV_ENV_HOMESERVER,
};

#[tokio::test]
async fn test_unauthorized_login_request() -> Result<()> {
    let request = api::session::login::Request::new(api::session::login::LoginInfo::Password {
        identifier: api::session::login::UserIdentifier::MatrixId("unauthorized_localpart"),
        password: "unauthorized_password",
    });

    let res = request_with_no_token(request).await?;

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    Ok(())
}

#[tokio::test]
async fn test_unauthorized_account_change_password_request() -> Result<()> {
    let request = api::account::change_password::Request::new("new_password");

    let res = request_with_unauthorized_access_token(request).await?;

    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    Ok(())
}

#[tokio::test]
async fn test_unauthorized_get_devices() -> Result<()> {
    let request = api::device::get_devices::Request::new();

    let res = request_with_unauthorized_access_token(request).await?;

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    Ok(())
}

#[tokio::test]
async fn test_unauthorized_get_device() -> Result<()> {
    let request = api::device::get_device::Request::new("unknown_device".into());

    let res = request_with_unauthorized_access_token(request).await?;

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    Ok(())
}

#[tokio::test]
async fn test_unauthorized_update_device() -> Result<()> {
    let request = api::device::update_device::Request::new("unknown_device".into());

    let res = request_with_unauthorized_access_token(request).await?;

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    Ok(())
}

async fn request_with_no_token(request: impl OutgoingRequest) -> Result<reqwest::Response> {
    do_request(request, SendAccessToken::None).await
}

async fn request_with_unauthorized_access_token(
    request: impl OutgoingRequest,
) -> Result<reqwest::Response> {
    do_request(request, SendAccessToken::IfRequired("unauthorized_token")).await
}

async fn do_request(
    request: impl OutgoingRequest,
    token: SendAccessToken<'_>,
) -> Result<reqwest::Response> {
    let request: http::Request<Vec<u8>> =
        request.try_into_http_request(DEV_ENV_HOMESERVER, token)?;

    let res = reqwest::Client::new()
        .execute(reqwest::Request::try_from(request)?)
        .await?;

    Ok(res)
}
