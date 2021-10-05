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

import express from "express";
import { IStage, AuthData, ParamsData, IAuthResponse } from "./stages/stage";
import { Log } from "./log";
import { ISessionObject } from "./session";
import { SingleUiaConfig, FlowsConfig } from "./config";

const STATUS_BAD_REQUEST = 400;
const STATUS_UNAUTHORIZED = 401;

export interface IAllParams {
	[key: string]: ParamsData;
}

/** Data for a 401 UIA response. */
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
		private expressApp: express.Application,
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
						await stage.init(this.config.stages[stage.type], {
							express: this.expressApp,
						});
					} else {
						await stage.init();
					}
				}
				this.stages.set(stage.type, stage);
			}
		}
	}

	public async getFlows(session: ISessionObject): Promise<FlowsConfig[]> {
		const outputFlows: FlowsConfig[] = [];
		for (let j = 0; j < this.config.flows.length; j++) {
			const configStages = this.config.flows[j].stages;
			const completed = session.completed || [];
			if (configStages.length < completed.length) {
				continue;
			}
			const stages: string[] = [];
			let stagesValid = true;
			let i = 0;
			for (const completedStage of completed) {
				if (session.skippedStages[j] && session.skippedStages[j].has(i)) {
					i++;
				}
				if (configStages[i] !== completedStage) {
					stagesValid = false;
					break;
				}
				stages.push(completedStage);
				i++;
			}
			if (!stagesValid || i > configStages.length) {
				continue;
			}
			if (i < configStages.length) {
				let first = true;
				for (; i < configStages.length; i++) {
					const stage = this.stages.get(configStages[i])!;
					let stageActive = true;
					if (stage.isActive) {
						stageActive = await stage.isActive(session.data);
					}
					if (stageActive) {
						stages.push(configStages[i]);
					} else if (first) {
						// add that we skipped it
						if (!session.skippedStages[j]) {
							session.skippedStages[j] = new Set<number>();
						}
						session.skippedStages[j].add(i);
					}
					first = false;
				}
			}
			outputFlows.push({
				stages,
			});
		}
		return outputFlows;
	}

	public async getParams(session: ISessionObject): Promise<IAllParams> {
		this.log.info("Fetching parameters...");
		const reply: IAllParams = {};
		const nextStages = await this.getNextStages(session);
		for (const [type, stage] of this.stages.entries()) {
			if (nextStages.has(type) && stage.getParams) {
				let params = session.params[type];
				if (!params) {
					params = await stage.getParams(session.data);
					session.params[type] = params;
					session.save();
				}
				reply[type] = params;
			}
		}
		return reply;
	}

	/** Check if there are any uncompleted stages. */
	public async areStagesComplete(session: ISessionObject): Promise<boolean> {
		const testStages = session.completed || [];
		for (const { stages } of await this.getFlows(session)) {
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

	/** Gives the set of remaining stages which need to be completed */
	public async getNextStages(session: ISessionObject): Promise<Set<string>> {
		const nextStages = new Set<string>();
		const currentStages = session.completed || [];
		for (const { stages } of await this.getFlows(session)) {
			const nextStage = stages[currentStages.length];
			// we only want to display as possible next stages the *valid* chains
			if (nextStage) {
				let stagesValid = true;
				for (let i = 0; i < currentStages.length; i++) {
					if (stages[i] !== currentStages[i]) {
						stagesValid = false;
					}
				}
				if (stagesValid) {
					nextStages.add(nextStage);
				}
			}
		}
		return nextStages;
	}

	/** Perform the authentication for the stage with the given type */
	public async challengeState(type: string, session: ISessionObject, data: AuthData): Promise<IAuthResponse> {
		const params = session.params[type] || null;
		return await this.stages.get(type)!.auth(data, params);
	}

	/**
	 * Responds to GET /login. This is *only* used for fallback to UIA-less /login,
	 * and thus *only* works if we only have an m.login.password stage configured.
	 * Clients using proper UIA on /login will never hit this endpoint.
	 * It was useful to add it for debuggin in e.g. Element
	 */
	public async get(_req: express.Request, res: express.Response) {
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

		// If no auth field is present in the request body, add all root fields
		// as fields on auth. This allows us to accept data from a call to
		// POST /login, because the root dict on that matches the auth dict on a
		// UIA call.
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
		// check that the submitted stage is in the set of remaining stages
		const nextStages = await this.getNextStages(req.session!);
		if (!nextStages.has(type)) {
			this.log.warn("This stage is invalid!");
			res.status(STATUS_BAD_REQUEST);
			res.json({
				errcode: "M_BAD_JSON",
				error: "Invalid stage to complete",
				...(await this.getBaseReply(req.session!)),
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
			// we don't use Object.assign to preserve pointers
			for (const prop of ["username", "password", "passwordProvider"]) {
				if (response.data[prop]) {
					req.session!.data[prop] = response.data[prop];
				}
			}
		}
		req.session!.completed.push(type);
		req.session!.save();
		this.log.info("Stage got completed");
		// now we check if all stages are complete
		if (!(await this.areStagesComplete(req.session!))) {
			this.log.info("Need to complete more stages, returning...");
			res.status(STATUS_UNAUTHORIZED);
			res.json(await this.getBaseReply(req.session!));
			return;
		}

		// If we don't end up down here then we replied with some sort of UIA conform thing
		// If we end up down here the request will be forwarded to homeserver
		req.session!.save();
		this.log.info("Successfully identified, passing on request!");
		next();
	}

	/**
	 * Generates an object for a 401 UIA response with a session id and a list
	 * of remaining stages.
	 */
	private async getBaseReply(session: ISessionObject): Promise<IBaseReply> {
		const reply: IBaseReply = {
			flows: await this.getFlows(session),
			params: await this.getParams(session),
			session: session.id,
		};
		if (session.completed) {
			reply.completed = session.completed;
		}
		session.save();
		return reply;
	}

	/** Returns the set of every stage we know about */
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
