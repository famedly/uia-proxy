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
import { IStage, AuthData, ParamsData, IAuthResponse } from "./stages/stage";
import { Log } from "./log";
import { ISessionObject } from "./session";
import { SingleUiaConfig, FlowsConfig } from "./config";

const STATUS_OK = 200;
const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;

export interface IAllParams {
	[key: string]: ParamsData;
}

interface IBaseReply {
	errcode?: string;
	error?: string;
	completed?: string[];
	flows: {
		stages: string[];
	}[];
	params: {[key: string]: ParamsData};
	session: string;
}

export class StageHandler {
	private stages: Map<string, IStage>;
	private log: Log;

	public constructor(
		logIdent: string,
		private config: SingleUiaConfig,
		stages?: Map<string, IStage>,
	) {
		this.log = new Log(`StageHandler (${logIdent})`);
		if (stages) {
			this.stages = stages;
		} else {
			this.stages = new Map();
		}
	}

	public async load(): Promise<void> {
		this.log.info("Loading stages...");
		const normalizedPath = require("path").join(__dirname, "stages");
		const files = require("fs").readdirSync(normalizedPath);
		const allStageTypes = this.getAllStageTypes();
		for (const file of files) {
			if (!file.startsWith("stage_")) {
				continue;
			}
			const stageClass = require("./stages/" + file).Stage;
			const stage = new stageClass();
			if (allStageTypes.has(stage.type)) {
				this.log.verbose(`Found stage ${stage.type}`);
				if (stage.init) {
					if (this.config.stages[stage.type]) {
						await stage.init(this.config.stages[stage.type]);
					} else {
						await stage.init();
					}
				}
				this.stages.set(stage.type, stage);
			}
		}
	}

	public getFlows(): FlowsConfig[] {
		return this.config.flows;
	}

	public async getParams(session: ISessionObject): Promise<IAllParams> {
		this.log.info("Fetching parameters...");
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

	public areStagesComplete(testStages: string[]): boolean {
		for (const { stages } of this.config.flows) {
			if (testStages.length !== stages.length) {
				continue;
			}
			let stagesComplete = true;
			for (let i = 0; i < stages.length; i++) {
				if (stages[i] !== testStages[i]) {
					stagesComplete = false;
				}
			}
			if (stagesComplete) {
				return true;
			}
		}
		return false;
	}

	public areStagesValid(testStages: string[]): boolean {
		for (const { stages } of this.config.flows) {
			let stagesValid = true;
			for (let i = 0; i < testStages.length; i++) {
				if (stages[i] !== testStages[i]) {
					stagesValid = false;
				}
			}
			if (stagesValid) {
				return true;
			}
		}
		return false;
	}

	public async challengeState(type: string, session: ISessionObject, data: AuthData): Promise<IAuthResponse> {
		const params = session.params[type] || null;
		return await this.stages.get(type)!.auth(data, params);
	}

	public async get(req: express.Request, res: express.Response) {
		this.log.info("Handling GET endpoint...");
		const stages = this.getAllStageTypes();
		if (stages.has("m.login.password")) {
			res.json({
				flows: [{ type: "m.login.password" }],
			});
		} else {
			res.json({flows: []});
		}
	}

	public async middleware(req: express.Request, res: express.Response, next: express.NextFunction) {
		this.log.info("Got request");
		if (!req.session) {
			this.log.warn("Bad session. Something went really wrong");
			// session is missing somehow
			res.status(STATUS_BAD_REQUEST);
			res.json({
				errcode: "M_UNRECOGNIZED",
				error: "Invalid session key",
			});
			return;
		}
		const data = req.body;
		if (!data.auth) {
			data.auth = data || {};
		}
		const type = data.auth.type;
		if (!type) {
			this.log.info("No type specified, returning blank reply");
			res.status(STATUS_UNAUTHORIZED);
			res.json(await this.getBaseReply(req.session!));
			return;
		}
		this.log.info(`Requesting stage ${type}...`);
		// now we test if the stage we want to try out is valid
		if (!req.session!.completed) {
			req.session!.completed = [];
		}
		// make that testStages hold a valid path
		const testStages = [...req.session!.completed];
		testStages.push(type);
		if (!this.areStagesValid(testStages)) {
			this.log.warn("This stage is invalid!");
			res.status(STATUS_BAD_REQUEST);
			res.json({
				errcode: "M_BAD_JSON",
				error: "Invalid stage to complete",
			});
			return;
		}
		this.log.info("Stage is valid");
		// ooookay, we have to tackle our stage now!
		const response = await this.challengeState(type, req.session!, data.auth);
		if (!response.success) {
			this.log.info("User didn't manage to complete this stage");
			const reply = await this.getBaseReply(req.session!);
			reply.errcode = response.errcode;
			reply.error = response.error;
			res.status(STATUS_UNAUTHORIZED);
			res.json(reply);
			return;
		}
		// okay, the stage was completed successfully
		if (response.data) {
			// we don't use Object.assign to reserve pointers
			for (const prop of ["username", "password", "passwordProvider"]) {
				if (response.data[prop]) {
					req.session!.data[prop] = response.data[prop];
				}
			}
		}
		req.session!.completed.push(type);
		req.session!.save();
		this.log.info("Stage got completed");
		// now we check if all stages are complet
		if (!this.areStagesComplete(req.session!.completed)) {
			this.log.info("Need to complete more stages, returning...");
			res.status(STATUS_UNAUTHORIZED);
			res.json(await this.getBaseReply(req.session!));
			return;
		}
		this.log.info("Successfully identified, passing on request!");
		next();
	}

	private async getBaseReply(session: ISessionObject): Promise<IBaseReply> {
		const reply: IBaseReply = {
			flows: this.getFlows(),
			params: await this.getParams(session),
			session: session.id,
		};
		if (session.completed) {
			reply.completed = session.completed;
		}
		return reply;
	}

	private getAllStageTypes(): Set<string> {
		const res = new Set<string>();
		for (const f of this.config.flows) {
			for (const s of f.stages) {
				res.add(s);
			}
		}
		return res;
	}
}
