
import LevelUP from "levelup";
import LevelDOWN from "rocksdb";
import { isLeft } from "fp-ts/Either";

import { Log } from "../src/log";
import { Config } from "../src/config"
import { readConfig } from "../src/index"
import { UsernameMapper, UsernameMapperEntry } from "../src/usernamemapper";
import { PasswordProvider } from "../src/passwordproviders/passwordprovider_ldap";
import { IStagePasswordConfig } from "../src/stages/stage_m.login.password";

const log = new Log("Repair")

async function run() {
	const config = readConfig();
	let passwordProvider: PasswordProvider | undefined;
	for (const endpoint of [config.uia.login, config.uia.password, config.uia.deleteDevice, config.uia.deleteDevices, config.uia.deleteDevices]) {
		let stage = endpoint.stages?.["m.login.password"] as IStagePasswordConfig | undefined;
		let ldapConfig = stage?.passwordproviders?.ldap;
		if (ldapConfig) {
			passwordProvider = new PasswordProvider();
			await passwordProvider.init(ldapConfig);
		}
	}
	if (!passwordProvider) {
		log.error("Couldn't find an LDAP password provider, aborting");
		return;
	}
	config.uia.login.stages?.["m.login.password"]?.ldap
	for await (const [localpart, rawEntry] of UsernameMapper.levelup.iterator()) {
		const decodeResult = UsernameMapperEntry.decode(rawEntry);
		if (isLeft(decodeResult)) {
			log.warn(`Could not decode entry for ${localpart}, skipping. Error was`, decodeResult.left);
			continue;
		}
		const entry = decodeResult.right;
		if (!entry.persistentId) {
			log.warn(`No persistent ID for ${localpart}, skipping`);
		}
		await passwordProvider.resetMapping(entry.persistentId!);
		log.verbose(`Reset mapping for ${localpart}`);
	}
}
run()
