use std::convert::TryFrom;

use famedly_e2e_testing::{
    eyre::Result,
    http, matrix_sdk,
    reqwest::{self, StatusCode},
    tokio, DEV_ENV_HOMESERVER,
};

#[tokio::test]
async fn test_unauthorized_login_request() -> Result<()> {
    let request = matrix_sdk::api::r0::session::login::Request::new(
        matrix_sdk::api::r0::session::login::LoginInfo::Password {
            identifier: matrix_sdk::api::r0::session::login::UserIdentifier::MatrixId(
                "unauthorized_localpart",
            ),
            password: "unauthorized_password",
        },
    );

    let res = request_with_no_token(request).await?;

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    Ok(())
}

#[tokio::test]
async fn test_unauthorized_account_change_password_request() -> Result<()> {
    let request = matrix_sdk::api::r0::account::change_password::Request::new("new_password");

    let res = request_with_unauthorized_access_token(request).await?;

    assert_eq!(res.status(), StatusCode::FORBIDDEN);

    Ok(())
}

#[tokio::test]
async fn test_unauthorized_get_devices() -> Result<()> {
    let request = matrix_sdk::api::r0::device::get_devices::Request::new();

    let res = request_with_unauthorized_access_token(request).await?;

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    Ok(())
}

#[tokio::test]
async fn test_unauthorized_get_device() -> Result<()> {
    let request = matrix_sdk::api::r0::device::get_device::Request::new("unknown_device".into());

    let res = request_with_unauthorized_access_token(request).await?;

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    Ok(())
}

#[tokio::test]
async fn test_unauthorized_update_device() -> Result<()> {
    let request = matrix_sdk::api::r0::device::update_device::Request::new("unknown_device".into());

    let res = request_with_unauthorized_access_token(request).await?;

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    Ok(())
}

async fn request_with_no_token(
    request: impl matrix_sdk::OutgoingRequest,
) -> Result<reqwest::Response> {
    do_request(request, matrix_sdk::SendAccessToken::None).await
}

async fn request_with_unauthorized_access_token(
    request: impl matrix_sdk::OutgoingRequest,
) -> Result<reqwest::Response> {
    do_request(
        request,
        matrix_sdk::SendAccessToken::IfRequired("unauthorized_token"),
    )
    .await
}

async fn do_request(
    request: impl matrix_sdk::OutgoingRequest,
    token: matrix_sdk::SendAccessToken<'_>,
) -> Result<reqwest::Response> {
    let request: http::Request<Vec<u8>> =
        request.try_into_http_request(DEV_ENV_HOMESERVER, token)?;

    let res = reqwest::Client::new()
        .execute(reqwest::Request::try_from(request)?)
        .await?;

    Ok(res)
}
