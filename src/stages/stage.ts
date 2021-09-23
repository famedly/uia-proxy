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

import { IExtraSessionData } from "../session";
import { StageConfig } from "../config";
import express from "express";

export type AuthData = any; // tslint:disable-line no-any
export type ParamsData = any; // tslint:disable-line no-any
export type StageConfigType = any; // tslint:disable-line no-any

export interface IAuthResponse {
	success: boolean;
	data?: IExtraSessionData;
	error?: string;
	errcode?: string;
}

export interface IStageUiaProxyVars {
	express: express.Application;
}

export interface IStage {
	type: string;
	isActive?(sessionData: IExtraSessionData): Promise<boolean>;
	getParams?(sessionData: IExtraSessionData): Promise<ParamsData>;
	init?(config: StageConfig, vars?: IStageUiaProxyVars): Promise<void>;
	auth(data: AuthData, params: ParamsData | null): Promise<IAuthResponse>;
}

/**
 * Gets the localpart from a fully qualified mxid, or does nothing if already a
 * localpart.
 *
 * @param mxid - The matrix id to get the localpart from
 * @param domain - The domain the id is expected to belong to
 *
 * @returns null if there's a domain mismatch. The localpart from the
 * argument otherwise.
 */
export function ensure_localpart(mxid: string, domain: string): string | null {
	if (mxid[0] === "@") {
		// id is fully qualified
		if (!mxid.endsWith(":" + domain)) {
			return null;
		}
		// remove "@"
		mxid = mxid.substr(1);
		// remove domain and ":" (hence the +1)
		mxid = mxid.substr(0, mxid.length - (domain.length + 1));
		return mxid;
	} else {
		// argument is already a localpart
		return mxid;
	}
}
