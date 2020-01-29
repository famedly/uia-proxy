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

import { Log } from "./log";
import { TimedCache } from "./structures/timedcache";
import { ParamsData } from "./stages/stage";
import { SessionConfig } from "./config";
import { IPasswordProvider } from "./passwordproviders/passwordprovider";

const log = new Log("Session");

// tslint:disable no-magic-numbers
const SESSION_LIFETIME = 1000 * 60 * 30;
const SESSION_ID_LENGTH = 20;
// tslint:enable no-magic-numbers

export interface IExtraSessionData {
	username?: string;
	password?: string;
	passwordProvider?: IPasswordProvider;
}

export interface ISessionData {
	id: string;
	params: {[type: string]: ParamsData};
	data: IExtraSessionData;
	completed?: string[];
	endpoint: string;
}

export interface ISessionObject extends ISessionData {
	save(): void;
}

export class Session {
	private sessions: TimedCache<string, ISessionData>;

	constructor(
		private config: SessionConfig,
	) {
		this.sessions = new TimedCache(this.config.timeout);
	}

	public new(endpoint: string): ISessionObject {
		let id = this.generateSessionId();
		while (this.sessions.has(id)) {
			id = this.generateSessionId();
		}
		const data = {
			id,
			params: {},
			data: {},
			endpoint,
		} as ISessionData;
		this.sessions.set(id, data);
		const obj = data as ISessionObject;
		obj.save = () => this.set(obj);
		return obj;
	}

	public get(id: string): ISessionObject | null {
		const data = this.sessions.get(id);
		if (!data) {
			return null;
		}
		const obj = data as ISessionObject;
		obj.save = () => this.set(obj);
		return obj;
	}

	public set(data: ISessionData): boolean {
		if (!this.sessions.has(data.id)) {
			return false;
		}
		this.sessions.set(data.id, data);
		return true;
	}

	private generateSessionId(): string {
		let result = "";
		const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
		const charsLen = chars.length;
		for (let i = 0; i < SESSION_ID_LENGTH; i++) {
			result += chars.charAt(Math.floor(Math.random() * charsLen));
		}
		return result;
	}
}
