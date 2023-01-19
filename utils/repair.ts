
import { Log } from "../src/log";
import { readConfig } from "../src/read"
import { UsernameMapper } from "../src/usernamemapper";
import { PasswordProvider } from "../src/passwordproviders/passwordprovider_ldap";

async function run() {
	const path = "config.yaml";
	const config = readConfig(path);
	const log = new Log("Repair");

	// Find an LDAP password provider in the config and initialize it
	let passwordProvider: PasswordProvider | undefined;
	for (const endpoint of [config.uia.default, config.uia.login, config.uia.password, config.uia.deleteDevice, config.uia.deleteDevices, config.uia.deleteDevices]) {
		const stage = endpoint?.stages?.["m.login.password"];
		const ldapConfig = stage?.passwordproviders?.ldap;
		if (ldapConfig) {
			passwordProvider = new PasswordProvider();
			await passwordProvider.init(ldapConfig);
			log.info("Initialized password provider");
			break;
		}
	}
	if (!passwordProvider) {
		log.error("Couldn't find an LDAP password provider, aborting");
		return;
	}
	// Iterate over the database
	for await (const [localpart, rawEntry] of UsernameMapper.levelup.iterator()) {
		log.verbose(`Resetting mapping for ${localpart}`)
		let entry: { username: string; persistentId?: Buffer; };
		try {
			const json = JSON.parse(rawEntry.toString());
			entry = { username: json.username }
			if (json.persistentId) {
				entry.persistentId = Buffer.from(json.persistentId)
			}
		} catch (err) {
			log.warn(`Could not decode entry for ${localpart}, skipping. Error was`, err.message ?? err);
			continue;
		}
		if (!entry.persistentId) {
			log.warn(`No persistent ID for ${localpart}, skipping`);
			continue;
		}
		await passwordProvider.resetMapping(entry.persistentId!);
		log.verbose(`Finished reset mapping for ${localpart}`);
	}
}
// tslint:disable-next-line no-floating-promises
run()
