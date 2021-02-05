# Famedly Login Service
This is a login service that implements UIA (User Interactive Auth) for matrix servers. It allows high customization and easy development of new stages and password providers.

## Installation
First clone the repository, then install it:
```bash
git clone git@gitlab.com:famedly/famedly-login-service.git
cd famedly-login-service
npm install
npm run build
```
Next create a `config.yaml` file, based on the `config.sample.yaml` file and edit it to your needs.

## Configuration
The configuration of stages and flows can seem rather complex at first, however, it is designed to eliminate redundant configuration.

First off, inside of the `uia` base object all the different endpoints are configured. Each endpoint configuration has a `stages` and a `flows` attribute. In the `stages` attribute lies the configuration for the different stages, and in the flows attribute the config for the different flows.
```yaml
uia:
  endpoint:
    stages:
      # <stages config>
    flows:
      # <flows config>
```

To configure the flows, you provide an array of different possible stages, as follows:
```yaml
uia:
  endpoint:
    stages:
      # <stages config>
    flows:
      - stages:
        - m.login.foo
        - m.login.bar
      - stages:
        - m.login.foo
        - m.login.dummy
```

In this example the `m.login.bar` stage is optional.

Now, some stages require additional configuration (e.g. password providers for `m.login.password`). As such, the stages object takes as key the stage it refers to and its content is the respectives stage config. For example:
```yaml
uia:
  endpoint:
    stages:
      m.login.foo:
        species: fox
        food: bunny
      m.login.bar:
        emailprovider: gmail
    flows:
      - stages:
        - m.login.foo
        - m.login.bar
      - stages:
        - m.login.foo
        - m.login.dummy
```

Note that `m.login.dummy` does not appear in the stages config, as this stage doesn't require a configuration.

Now, if you have multiple endpoints with the same stages that would mean you'd have to copy-paste the stage config around. To eliminate that the stage configuration can be templates with in the `stages` object. For that the key is the alias, the `type` is the stage type and the `config` is the stages config. After that, in the stages config of the endpoint, as key the alias can be used. If additional configuration options are set they override those of the template. So the following configuration is equivalent to the one above:

```yaml
stages:
  foxhole:
    type: m.login.foo
    config:
      species: fox
      food: bunny

uia:
  endpoint:
    stages:
      foxhole:
      m.login.bar:
        emailprovider: gmail
    flows:
      - stages:
        - m.login.foo
        - m.login.bar
      - stages:
        - m.login.foo
        - m.login.dummy
```

The advantage is, that the configuration can easily be re-used for a different endpoint:
```yaml
stages:
  foxhole:
    type: m.login.foo
    config:
      species: fox
      food: bunny

uia:
  endpoint:
    stages:
      foxhole:
      m.login.bar:
        emailprovider: gmail
    flows:
      - stages:
        - m.login.foo
        - m.login.bar
      - stages:
        - m.login.foo
        - m.login.dummy
  other_endpoint:
    stages:
      foxhole:
        food: burgers # we override the "food" parameter of the config!
    flows:
      - stages:
        - m.login.foo
```

Additionally the `homeserver` config is automatically added to all stage configurations.

Similarly you can also define entire UIA config blobs in `templates`, helpful e.g. if you have multiple
endpoints which require only a password. These can also use stage templates, as such:

```yaml
stages:
  password:
    type: m.login.password
    config:
      passwordproviders:
        ldap:
          url: ldap://localhost
          # and the remaining ldap config

templates:
  password_only:
    stages:
      password:
    flows:
      - stages:
        - m.login.password

uia:
  login: # login endpoint
    password_only:
  password: # password change endpoint
    password_only:
```

As a lot of endpoints probably have the same config option, you can also define a default,
which is used for all endpoints not explicitly defined, as so:
```yaml
stages:
  password:
    type: m.login.password
    config:
      passwordproviders:
        ldap:
          url: ldap://localhost
          # and the remaining ldap config

templates:
  password_only:
    stages:
      password:
    flows:
      - stages:
        - m.login.password

uia:
  default: # default for all endpoints
    password_only:
```

## Stage configurations
### m.login.dummy
The stage `m.login.dummy` does not need any configuration.

### m.login.password
The config for the `m.login.password` stage looks as follows:
```yaml
passwordproviders:
  # <password providers config>
```

The password providers config consists out of the type (the key) and its respective config (the value). For example:
```yaml
passwordproviders:
  ldap:
    url: ldap://localhost
    # ...additional config needed for ldap...
  dummy: # DO NOT USE THIS IN PRODUCTION
    validPassword: foxies
```

### com.famedly.login.welcome_message
The config for the `com.famedly.welcome_message` contains either a `welcomeMessage` or a `file` where to read the message from.
If both are given then the file is used. For example:
```yaml
file: /path/to/welcome/message.txt
```

## Password provider configurations
### dummy
The `dummy` password provider is **NOT** meant for production. It exists only for testing purposes. It has the following configuration:
```yaml
# the password which is valid
validPassword: foxies
```

### ldap
The `ldap` password provider authenticates a user with ldap and, optionally, re-writes their mxid to the random hash. It needs a search user to be able to log in as users via their persistent ID. Its configuration can look as follows:
```yaml
# The URL endpoint of ldap
ldap: ldap://localhost
# The base DN of the users
base: dc=localhost,dc=localdomain
# the bind DN of the search user
bindDn: cn=search,dc=localhost,dc=localdomain
# the bind password of the seach user
bindPassword: super secret
# the group of deactivated users
deactivatedGroup: cn=deactivatedUsers,ou=groups,dc=famedly,dc=de
# The attribute map of the ldap attributes
attributes:
  # The username of the user
  uid: cn
  # The persistent ID of the user, to generate the random mxid of
  persistentId: uid
```

## Endpoints
`login`: Login endpoint called upon logging in
`password`: Endpoint called when changing a password
`deleteDevice`: Endpoint called when deleting a single device
`deleteDevices`: Endpoint called when deleting multiple devices
