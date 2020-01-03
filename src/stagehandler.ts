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

import { IStage, ParamsType } from "./stages/stage";
import { Log } from "./log";
import { ISessionObject } from "./session";
import { StagesConfig, FlowsConfig } from "./config";

const log = new Log("StageHandler");

export interface IAllParams {
	[key: string]: ParamsType;
}

export class StageHandler {
	private stages: Map<string, IStage>;

	public constructor(
		private stagesConfig: StagesConfig,
		private flowsConfig: FlowsConfig[],
	) {
		this.stages = new Map();
	}

	public async load(): Promise<void> {
		log.info("Loading stages...");
		const normalizedPath = require("path").join(__dirname, "stages");
		const files = require("fs").readdirSync(normalizedPath);
		const allStageTypes = this.getAllStageTypes();
		for (const file of files) {
			if (file === "stage.js") {
				continue;
			}
			const stageClass = require("./stages/" + file).Stage;
			const stage = new stageClass();
			if (allStageTypes.has(stage.type)) {
				log.verbose(`Found stage ${stage.type}`);
				if (stage.init) {
					await stage.init();
				}
				this.stages.set(stage.type, stage);
			}
		}
	}

	public getFlows(): FlowsConfig[] {
		return this.flowsConfig;
	}

	public async getParams(session: ISessionObject): Promise<IAllParams> {
		log.info("Fetching parameters...");
		const reply: IAllParams = {};
		for (const [type, stage] of this.stages.entries()) {
			if (stage.getParams) {
				let params = session.params[type];
				if (!params) {
					params = await stage.getParams();
					session.params[type] = params;
					session.save();
				}
				reply[type] = params;
			}
		}
		return reply;
	}

	private getAllStageTypes(): Set<string> {
		const res = new Set<string>();
		for (const f of this.flowsConfig) {
			for (const s of f.stages) {
				res.add(s);
			}
		}
		return res;
	}
}
