
import { isLeft } from "fp-ts/Either";

import { Config } from "../src/config";
import { Log } from "../src/log";
import { UsernameMapper, UsernameMapperEntry } from "../src/usernamemapper";
import { PasswordProvider } from "../src/passwordproviders/passwordprovider_ldap";
import { IStagePasswordConfig } from "../src/stages/stage_m.login.password";

const log = new Log("Repair")

export async function repairDb(config: Config) {
	// Find an LDAP password provider in the config and initialize it
	let passwordProvider: PasswordProvider | undefined;
	for (const endpoint of [config.uia.login, config.uia.password, config.uia.deleteDevice, config.uia.deleteDevices, config.uia.deleteDevices]) {
		const stage = endpoint.stages?.["m.login.password"] as IStagePasswordConfig | undefined;
		const ldapConfig = stage?.passwordproviders?.ldap;
		if (ldapConfig) {
			passwordProvider = new PasswordProvider();
			await passwordProvider.init(ldapConfig);
			break;
		}
	}
	if (!passwordProvider) {
		log.error("Couldn't find an LDAP password provider, aborting");
		return;
	}
	// Iterate over the database
	for await (const [localpart, rawEntry] of UsernameMapper.levelup.iterator()) {
		const decodeResult = UsernameMapperEntry.decode(rawEntry);
		if (isLeft(decodeResult)) {
			log.warn(`Could not decode entry for ${localpart}, skipping. Error was`, decodeResult.left);
			continue;
		}
		const entry = decodeResult.right;
		if (!entry.persistentId) {
			log.warn(`No persistent ID for ${localpart}, skipping`);
			continue;
		}
		await passwordProvider.resetMapping(entry.persistentId!);
		log.verbose(`Finished resetting mapping for ${localpart}`);
	}
}
