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

import { IStage, ParamsData, AuthData, IAuthResponse } from "./stage";
import { Log } from "../log";
import * as fs from "fs";
import { StageConfig } from "../config";
import { IExtraSessionData } from "../session";

const log = new Log("Stage com.famedly.login.welcome_message");

interface IStageWelcomeMessageConfig extends StageConfig {
	welcomeMessage?: string;
	file?: string;
}

export class Stage implements IStage {
	public type: string = "com.famedly.login.welcome_message";
	private config: IStageWelcomeMessageConfig;

	public async init(config: IStageWelcomeMessageConfig) {
		this.config = config;
	}

	public async isActive(sessionData: IExtraSessionData): Promise<boolean> {
		return await this.getWelcomeMessage() !== "";
	}

	public async getParams(sessionData: IExtraSessionData): Promise<ParamsData> {
		return {
			welcome_message: await this.getWelcomeMessage(),
		};
	}

	public async auth(data: AuthData, params: ParamsData | null): Promise<IAuthResponse> {
		// we just yield this as success, as the core part is about the client displaying.
		return {
			success: true,
		};
	}

	private async getWelcomeMessage(): Promise<string> {
		if (this.config.file) {
			return (await new Promise<string>((res, rej) => {
				fs.readFile(this.config.file!, "utf8", (err, data) => {
					if (err) {
						log.warn("Failed to read welcome message from file: " + err);
						res("");
						return;
					}
					res(data);
				});
			})).trim();
		}
		return (this.config.welcomeMessage || "").trim();
	}
}
