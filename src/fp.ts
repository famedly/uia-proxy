/** Helper functions for fp-ts types */
import * as E from "fp-ts/Either";
import * as t from "io-ts";
import reporter from "io-ts-reporters";

/** Returns the contained value if right, throws an error if left */
export function unwrap<T>(either: t.Validation<T>): T {
	if (E.isRight(either)) {
		return either.right;
	} else {
		throw new Error(reporter.report(either).join("\n"));
	}
}

/** Codec for the node std Buffer type */
export const buffer = new t.Type<Buffer, {type: "Buffer", data: number[]}, Buffer>(
	"Buffer",
	(input: unknown): input is Buffer => (Buffer.isBuffer(input)),
	(input, context) => {
		try {
			// eslint-disable-next-line  @typescript-eslint/no-explicit-any
			return t.success(Buffer.from(input as any))
		} catch (e) {
			return t.failure(e, context);
		}
	},
	(output) => (output.toJSON())
)
