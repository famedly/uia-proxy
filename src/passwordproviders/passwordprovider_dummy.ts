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

import { PasswordProviderConfig, IPasswordResponse, IPasswordProvider } from "./passwordprovider";

interface IPasswordProviderDummyConfig {
	validPassword: string;
}

export class PasswordProvider implements IPasswordProvider {
	public type: string = "dummy";
	private config: IPasswordProviderDummyConfig;

	async init(config: IPasswordProviderDummyConfig) {
		this.config = config;
	}

	async checkPassword(username: string, password: string): Promise<IPasswordResponse> {
		return {
			success: password === this.config.validPassword,
		};
	}
}
