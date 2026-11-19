import type { MediaConversionSettings } from "../types";

/** Image MIME types sharp can convert. */
export const CONVERTIBLE_IMAGE_MIME_TYPES = [
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
];

export const CONVERSION_CONTENT_TYPES: Record<string, string> = {
	avif: "image/avif",
	jpeg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
};

/**
 * Responsive width variants named `w{width}`, e.g. `w640`. Images are only
 * scaled down, never enlarged.
 */
export const widthConversions = (
	widths: number[],
	{
		format = "webp",
		quality = 75,
	}: Pick<MediaConversionSettings, "format" | "quality"> = {},
): MediaConversionSettings[] =>
	widths.map((width) => ({
		name: `w${width}`,
		width,
		format,
		quality,
		fit: "inside",
		withoutEnlargement: true,
	}));

export interface ConversionOutput {
	data: Buffer;
	width: number;
	height: number;
	format: string;
	size: number;
}

/** Render one conversion with sharp (loaded lazily as an optional peer). */
export const renderConversion = async (
	source: Buffer,
	conversion: MediaConversionSettings,
): Promise<ConversionOutput> => {
	const { default: sharp } = await import("sharp");

	// rotate() applies EXIF orientation before metadata is stripped
	let transform = sharp(source).rotate();

	if (conversion.width || conversion.height) {
		transform = transform.resize({
			width: conversion.width,
			height: conversion.height,
			fit: conversion.fit || "contain",
			withoutEnlargement: conversion.withoutEnlargement,
		});
	}

	if (conversion.format) {
		transform = transform.toFormat(conversion.format, {
			quality: conversion.quality || 80,
		});
	}

	const { data, info } = await transform.toBuffer({ resolveWithObject: true });

	return {
		data,
		width: info.width,
		height: info.height,
		format: info.format,
		size: info.size,
	};
};
