/** Helper functions for fp-ts types */
import * as E from "fp-ts/Either";
import * as t from "io-ts";
import { PathReporter } from "io-ts/PathReporter";

/** Returns the contained value if right, throws an error if left */
export function unwrap<T>(either: t.Validation<T>): T {
	if (E.isRight(either)) {
		return either.right;
	} else {
		throw new Error(PathReporter.report(either).join(" "));
	}
}

/** Codec for the node std Buffer type */
export const buffer = new t.Type<Buffer, {type: "Buffer", data: number[]}, Buffer>(
	"Buffer",
	(input: unknown): input is Buffer => (Buffer.isBuffer(input)),
	(input, context) => {
		try {
			// tslint:disable-next-line no-any
			return t.success(Buffer.from(input as any))
		} catch (e) {
			return t.failure(e, context);
		}
	},
	(output) => (output.toJSON())
)
