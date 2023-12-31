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

const log = new Log("Stage m.login.dummy");

export class Stage implements IStage {
	public type: string = "m.login.dummy";

	public async auth(data: AuthData, params: ParamsData | null): Promise<IAuthResponse> {
		log.info("Doing auth, returning success");
		return {
			success: true,
		};
	}
}
