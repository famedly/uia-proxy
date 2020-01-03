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

export interface IAuthData {
	[key: string]: string;
}

export type ParamsType = any; // tslint:disable-line no-any
export type StageConfigType = any; // tslint:disable-line no-any

export interface IAuthResponse {
	success: boolean;
	user?: string;
	error?: string;
	errcode?: string;
}

export interface IStage {
	type: string;
	getParams?(): Promise<ParamsType>;
	init?(config: StageConfigType): Promise<void>;
	auth(data: IAuthData, params: ParamsType | null): Promise<IAuthResponse>;
}
