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

export type PasswordProviderConfig = unknown;

export interface IPasswordResponse {
	success: boolean;
	username?: string;
	/** Update display name to this value if set */
	displayname?: string;
	/** Update admin status to this value if set */
	admin?: boolean;
}

export interface IPasswordProvider {
	type: string;
	init?(config: PasswordProviderConfig): Promise<void>;
	checkUser(username: string, password: string): Promise<IPasswordResponse>;
	changePassword?(username: string, oldPassword: string, newPassword: string): Promise<boolean>;
}
