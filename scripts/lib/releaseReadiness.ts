export interface VersionCheckResult {
  localVersion: string
  publishedVersion: string
  ready: boolean
  message: string
}

export function evaluatePublishedVersionReadiness(input: {
  packageName: string
  localVersion: string
  publishedVersion: string
}): VersionCheckResult {
  const { packageName, localVersion, publishedVersion } = input

  if (!publishedVersion.trim()) {
    throw new Error(`Published version lookup for ${packageName} returned an empty result.`)
  }

  if (localVersion === publishedVersion) {
    return {
      localVersion,
      publishedVersion,
      ready: false,
      message:
        `Version ${localVersion} is already published to npm. ` +
        'Bump package.json with `npm version patch|minor|major` before release.',
    }
  }

  return {
    localVersion,
    publishedVersion,
    ready: true,
    message: `New version: ${localVersion} (published: ${publishedVersion})`,
  }
}
