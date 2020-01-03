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

import * as express from "express";
import { Session } from "./session";
import { StageHandler } from "./stagehandler";
import { ParamsType } from "./stages/stage";

interface IApiBaseReply {
	flows: {
		stages: string[]
	}[];
	params: {[key: string]: ParamsType};
	session: string;
}

export class Api {
	constructor(
		private session: Session,
		private stageHandler: StageHandler,
	) { }

	public async getBaseReply(req: express.Request): Promise<IApiBaseReply> {
		return {
			flows: this.stageHandler.getFlows(),
			params: await this.stageHandler.getParams(req.session!),
			session: req.session!.id,
		};
	}
}
