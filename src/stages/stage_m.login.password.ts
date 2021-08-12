/*
Copyright (C) 2020 Famedly

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

import { IStage, ParamsData, AuthData, IAuthResponse, ensure_localpart } from "./stage";
import { PasswordProviderConfig, IPasswordProvider } from "../passwordproviders/passwordprovider";
import { Log } from "../log";
import { StageConfig } from "../config";

const log = new Log("Stage m.login.password");

interface IStagePasswordConfig extends StageConfig {
	passwordproviders: {[key: string]: PasswordProviderConfig};
	passwordproviderobjects?: IPasswordProvider[]; // for tests
}

export class Stage implements IStage {
	public type: string = "m.login.password";
	private config: IStagePasswordConfig;
	private passwordProviders: IPasswordProvider[];

	public async init(config: IStagePasswordConfig) {
		log.info("Loading password providers...");
		this.config = config;
		this.passwordProviders = [];
		if (this.config.passwordproviderobjects) {
			this.passwordProviders = this.config.passwordproviderobjects;
			return;
		}
		const normalizedPath = require("path").join(__dirname, "../passwordproviders");
		const files = require("fs").readdirSync(normalizedPath);
		const allPasswordProviderTypes = this.getAllPasswordProviderTypes();
		for (const file of files) {
			if (!file.startsWith("passwordprovider_")) {
				continue;
			}
			const passwordProviderClass = require("../passwordproviders/" + file).PasswordProvider;
			const passwordProvider = new passwordProviderClass();
			if (allPasswordProviderTypes.has(passwordProvider.type)) {
				log.verbose(`Found password provider ${passwordProvider.type}`);
				if (passwordProvider.init) {
					await passwordProvider.init(this.config.passwordproviders[passwordProvider.type]);
				}
				this.passwordProviders.push(passwordProvider);
			}
		}
	}

	public async auth(data: AuthData, _params: ParamsData | null): Promise<IAuthResponse> {
		// synapse / riot still do this off-spec, so let's mimmic this here...
		let user = data.user;
		if (!user) {
			// first we check if this is the correct identifier
			if (!data.identifier || data.identifier.type !== "m.id.user") {
				return {
					success: false,
					errcode: "M_UNKNOWN",
					error: "Bad login type.",
				};
			}
			user = data.identifier.user;
		}

		// next we validate if username and password exist and are strings
		const password = data.password;
		if (typeof user !== "string" || typeof password !== "string") {
			return {
				success: false,
				errcode: "M_BAD_JSON",
				error: "Missing username or password",
			};
		}

		// next we extract the localpart if we have a full mxid
		let username = ensure_localpart(user, this.config.homeserver.domain);
		if (!username) {
			return {
				success: false,
				errcode: "M_UNKNOWN",
				error: "Bad User",
			};
		}
		// now iterate over all password providers
		for (const passwordProvider of this.passwordProviders) {
			const response = await passwordProvider.checkPassword(username, password);
			if (response.success) {
				if (response.username) {
					username = response.username;
				}
				return {
					success: true,
					data: {
						username,
						password,
						passwordProvider,
					},
				};
			}
		}
		return {
			success: false,
			errcode: "M_FORBIDDEN",
			error: "User not found or invalid password",
		};
	}

	private getAllPasswordProviderTypes(): Set<string> {
		const res = new Set<string>();
		for (const type in this.config.passwordproviders) {
			if (this.config.passwordproviders.hasOwnProperty(type)) {
				res.add(type);
			}
		}
		return res;
	}
}
