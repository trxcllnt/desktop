/* eslint-disable no-sync */

import * as fs from 'fs-extra'
import * as cp from 'child_process'
import * as path from 'path'
import * as crypto from 'crypto'
import * as electronInstaller from 'electron-winstaller'
import * as glob from 'glob'
import * as YAML from 'yaml'
import * as temp from 'temp'
const rimraf = require('rimraf')

import { getProductName, getCompanyName, getVersion } from '../app/package-info'
import {
  getDistPath,
  getDistRoot,
  getOSXZipPath,
  getWindowsIdentifierName,
  getWindowsStandaloneName,
  getWindowsInstallerName,
  shouldMakeDelta,
  getUpdatesURL,
} from './dist-info'
import { isAppveyor } from './build-platforms'

const distRoot = getDistRoot()
const distPath = getDistPath()
const productName = getProductName()
const installerDir = path.join(distRoot, 'installer')

if (process.platform === 'darwin') {
  packageOSX()
} else if (process.platform === 'win32') {
  packageWindows()
} else if (process.platform === 'linux') {
  packageLinux()
} else {
  console.error(`I dunno how to package for ${process.platform} :(`)
  process.exit(1)
}

function packageOSX() {
  const dest = getOSXZipPath()
  fs.removeSync(dest)

  cp.execSync(
    `ditto -ck --keepParent "${distPath}/${productName}.app" "${dest}"`
  )
  console.log(`Zipped to ${dest}`)
}

function packageWindows() {
  const setupCertificatePath = path.join(
    __dirname,
    'setup-windows-certificate.ps1'
  )
  const cleanupCertificatePath = path.join(
    __dirname,
    'cleanup-windows-certificate.ps1'
  )

  if (isAppveyor()) {
    cp.execSync(`powershell ${setupCertificatePath}`)
  }

  const iconSource = path.join(
    __dirname,
    '..',
    'app',
    'static',
    'logos',
    'icon-logo.ico'
  )

  if (!fs.existsSync(iconSource)) {
    console.error(`expected setup icon not found at location: ${iconSource}`)
    process.exit(1)
  }

  const splashScreenPath = path.resolve(
    __dirname,
    '../app/static/logos/win32-installer-splash.gif'
  )

  if (!fs.existsSync(splashScreenPath)) {
    console.error(
      `expected setup splash screen gif not found at location: ${splashScreenPath}`
    )
    process.exit(1)
  }

  const iconUrl = 'https://desktop.githubusercontent.com/app-icon.ico'

  const nugetPkgName = getWindowsIdentifierName()
  const options: electronInstaller.Options = {
    name: nugetPkgName,
    appDirectory: distPath,
    outputDirectory: installerDir,
    authors: getCompanyName(),
    iconUrl: iconUrl,
    setupIcon: iconSource,
    loadingGif: splashScreenPath,
    exe: `${nugetPkgName}.exe`,
    title: productName,
    setupExe: getWindowsStandaloneName(),
    setupMsi: getWindowsInstallerName(),
  }

  if (shouldMakeDelta()) {
    options.remoteReleases = getUpdatesURL()
  }

  if (isAppveyor()) {
    const certificatePath = path.join(__dirname, 'windows-certificate.pfx')
    options.signWithParams = `/f ${certificatePath} /p ${
      process.env.WINDOWS_CERT_PASSWORD
    } /tr http://timestamp.digicert.com /td sha256`
  }

  electronInstaller
    .createWindowsInstaller(options)
    .then(() => {
      console.log(`Installers created in ${installerDir}`)
      cp.execSync(`powershell ${cleanupCertificatePath}`)
    })
    .catch(e => {
      cp.execSync(`powershell ${cleanupCertificatePath}`)
      console.error(`Error packaging: ${e}`)
      process.exit(1)
    })
}

function getSha256Checksum(fullPath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const algo = 'sha256'
    const shasum = crypto.createHash(algo)

    const s = fs.createReadStream(fullPath)
    s.on('data', function(d) {
      shasum.update(d)
    })
    s.on('error', err => {
      reject(err)
    })
    s.on('end', function() {
      const d = shasum.digest('hex')
      resolve(d)
    })
  })
}

function buildUsingElectronBuilder() {
  const electronBuilder = path.resolve(
    __dirname,
    '..',
    'node_modules',
    '.bin',
    'electron-builder'
  )

  const configPath = path.resolve(__dirname, 'electron-builder-linux.yml')

  const args = [
    'build',
    '--prepackaged',
    distPath,
    '--x64',
    '--config',
    configPath,
  ]

  const { error } = cp.spawnSync(electronBuilder, args, {
    stdio: 'inherit',
  })

  if (error != null) {
    throw error
  }

  const generatedInstallers = `${distRoot}/GitHubDesktop*`
  glob(generatedInstallers, async (error, files) => {
    if (error != null) {
      throw error
    }

    if (files.length === 0) {
      throw new Error(`No installers found`)
    }

    for (const f of files) {
      const fileName = path.basename(f)
      const dest = path.join(installerDir, fileName)
      console.log(`Moving ${f} -> ${dest}`)
      await fs.move(f, dest, { overwrite: true })
    }
  })
}

async function buildSnapPackage(): Promise<void> {
  const distPath = getDistPath()

  const tmpDir = temp.mkdirSync('desktop-snap-package')

  // TODO: create this as a temporary directory rather than within the distribution

  await fs.mkdirp(path.join(distPath, 'bin'))
  await fs.mkdirp(path.join(tmpDir, 'snap', 'gui'))

  const arch = 'amd64'

  const yaml = {
    name: 'github-desktop',
    version: getVersion(),
    summary: 'Simple collaboration from your desktop',
    description: 'Description goes here',
    grade: 'stable',
    confinement: 'classic',
    apps: {
      'github-desktop': {
        environment: {
          TMPDIR: '$XDG_RUNTIME_DIR',
        },
        command: "bin/electron-launch '$SNAP/github-desktop/github-desktop'",
      },
    },
    parts: {
      'github-desktop': {
        source: distPath,
        plugin: 'dump',
        'stage-packages': [
          // default Electron dependencies
          'libnotify4',
          'libnss3',
          'libpcre3',
          'libxss1',
          'libxtst6',
          // additional Desktop dependencies
          'libcurl3',
          'openssh-client',
          'gettext',
        ],
        after: ['desktop-gtk3'],
      },
    },
  }

  const snapcraftYamlText = YAML.stringify(yaml)

  await fs.writeFile(
    path.join(tmpDir, 'snap', 'snapcraft.yaml'),
    snapcraftYamlText
  )

  // TODO: not copy this file into the distribution directory

  const launcherPath = path.join(distPath, 'bin', 'electron-launch')
  const launcherContents = `#!/bin/sh

exec "$@" --executed-from="$(pwd)" --pid=$$
`

  await fs.writeFile(launcherPath, launcherContents, { mode: 0x755 })

  const desktopDesktopFile = `[Desktop Entry]
Name=GitHub Desktop
Exec=github-desktop %U
Icon=$\{SNAP\}/meta/gui/icon.png
Type=Application
StartupNotify=true
`

  await fs.writeFile(
    path.join(tmpDir, 'snap', 'gui', 'github-desktop.desktop'),
    desktopDesktopFile
  )

  const sourceIconPath = path.join(
    getDistPath(),
    'resources',
    'app',
    'static',
    'icon-logo.png'
  )

  const destinationIconPath = path.join(tmpDir, 'snap', 'gui', 'icon.png')
  await fs.copyFile(sourceIconPath, destinationIconPath)

  const { error } = cp.spawnSync('snapcraft', [`--target-arch=${arch}`], {
    cwd: tmpDir,
    stdio: 'inherit',
  })
  if (error != null) {
    throw error
  }

  const generatedInstaller = `${tmpDir}/*.snap`
  glob(generatedInstaller, async (error, files) => {
    if (error != null) {
      throw error
    }

    if (files.length !== 1) {
      throw new Error(`Found unexpected files: ${JSON.stringify(files)}`)
    }

    const installer = files[0]

    const snapArchive = path.join(
      installerDir,
      `GitHubDesktop-${getVersion()}-${arch}.snap`
    )

    await fs.move(installer, snapArchive)
  })
}

function generateChecksums() {
  const repositoryRoot = path.dirname(distRoot)
  const installersPath = `${installerDir}/GitHubDesktop*`

  glob(installersPath, async (error, files) => {
    if (error != null) {
      throw error
    }

    if (files.length === 0) {
      throw new Error(`Could not find any files at ${installersPath}`)
    }

    const checksums = new Map<string, string>()

    for (const f of files) {
      const relativePath = path.relative(repositoryRoot, f)
      console.log(`Found installer: '${relativePath}'`)
      const checksum = await getSha256Checksum(f)
      checksums.set(f, checksum)
    }

    let checksumsText = `Checksums: \n`

    for (const [fullPath, checksum] of checksums) {
      const fileName = path.basename(fullPath)
      checksumsText += `${checksum} - ${fileName}\n`
    }

    const checksumFile = path.join(installerDir, 'checksums.txt')

    fs.writeFile(checksumFile, checksumsText)
  })
}

async function packageLinux() {
  rimraf.sync(installerDir)
  await fs.mkdirp(installerDir)

  buildUsingElectronBuilder()

  await buildSnapPackage()

  generateChecksums()
}
