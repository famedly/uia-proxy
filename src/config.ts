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

// tslint:disable no-magic-numbers
const THIRTY_MIN = 30 * 60 * 1000;
const TWO_MIN = 120 * 1000;
// tslint:enable no-magic-numbers

export class Config {
	public logging: LoggingConfig = new LoggingConfig();
	public webserver: WebserverConfig = new WebserverConfig();
	public session: SessionConfig = new SessionConfig();
	public homeserver: HomeserverConfig = new HomeserverConfig();
	public stages: StagesTempalteConfig = new StagesTempalteConfig();
	public uia: UiaConfig = new UiaConfig();

	// tslint:disable-next-line no-any
	public applyConfig(newConfig: {[key: string]: any}, layer: {[key: string]: any} = this) {
		for (const key in newConfig) {
			if (newConfig.hasOwnProperty(key)) {
				if (layer[key] instanceof Object && !(layer[key] instanceof Array)) {
					this.applyConfig(newConfig[key], layer[key]);
				} else {
					layer[key] = newConfig[key];
				}
			}
		}
	}
}

export class LoggingConfig {
	public console: string = "info";
	public lineDateFormat: string = "MMM-D HH:mm:ss.SSS";
	public files: LoggingFile[] = [];
}

export class LoggingFile {
	public file: string;
	public level: string = "info";
	public maxFiles: string = "14d";
	public maxSize: string|number = "50m";
	public datePattern: string = "YYYY-MM-DD";
	public enabled: string[] = [];
	public disabled: string[] = [];
}

export class WebserverConfig {
	public host: string;
	public port: number;
}

export class FlowsConfig {
	public stages: string[] = [];
}

export class SessionConfig {
	public timeout: number = THIRTY_MIN;
}

export class HomeserverTokenConfig {
	public secret: string;
	public algorithm: string;
	public expires: number = TWO_MIN;
}

export class HomeserverConfig {
	public domain: string;
	public url: string;
	public token: HomeserverTokenConfig = new HomeserverTokenConfig();
}

export class StagesTemplateSingleConfig {
	public type: string;
	public config: StageConfig;
}

export class StagesTempalteConfig {
	[key: string]: StagesTemplateSingleConfig;
}

export class StageConfig {
	public homeserver: HomeserverConfig = new HomeserverConfig();
	[key: string]: any; // tslint:disable-line no-any
}

export class SingleUiaConfig {
	public stages: {[key: string]: StageConfig} = {};
	public flows: FlowsConfig[] = [];
}

export class UiaConfig {
	public login: SingleUiaConfig = new SingleUiaConfig();
}
