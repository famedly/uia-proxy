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

import { TimedCache } from "./structures/timedcache";
import { ParamsData } from "./stages/stage";
import { SessionConfig } from "./config";
import { IPasswordProvider } from "./passwordproviders/passwordprovider";

// tslint:disable no-magic-numbers
const SESSION_ID_LENGTH = 20;
// tslint:enable no-magic-numbers

// NOTE: If you add a property here, find the "we don't use Object.assign to
// preserve pointers" comment in stagehandler.ts and check if the new property
// should be added to the list of properties in the for loop.
export interface IExtraSessionData {
	sessionId?: string;
	username?: string;
	displayname?: string;
	/** Whether the user should be an administrator or not */
	admin?: boolean;
	password?: string;
	passwordProvider?: IPasswordProvider;
}

export interface ISessionData {
	id: string;
	params: {[type: string]: ParamsData};
	data: IExtraSessionData;
	completed?: string[];
	skippedStages: {[type: number]: Set<number>};
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
			data: {
				sessionId: id,
			},
			endpoint,
			skippedStages: {},
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
