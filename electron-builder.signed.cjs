// Separate release profile: never replace the existing unsigned development build.
const { build } = require('./package.json');
const thumbprint = process.env.SHIGUANG_SIGNING_THUMBPRINT?.replace(/\s/g, '');
const certificateLink = process.env.WIN_CSC_LINK || process.env.CSC_LINK;

if (!thumbprint && !certificateLink) {
  throw new Error('可信签名构建需要 WIN_CSC_LINK/CSC_LINK 或 SHIGUANG_SIGNING_THUMBPRINT；尚未配置凭据，已停止，未生成未签名发布包。');
}
if (thumbprint && !/^[a-f0-9]{40}$/i.test(thumbprint)) {
  throw new Error('SHIGUANG_SIGNING_THUMBPRINT 必须是 Windows 证书库中的 40 位 SHA-1 指纹。');
}
if (thumbprint && certificateLink) {
  throw new Error('请仅选择证书库指纹或证书文件一种签名方式，避免误选发布身份。');
}

module.exports = {
  ...build,
  extends: null,
  forceCodeSigning: true,
  directories: { ...build.directories, output: 'release-signed' },
  win: {
    ...build.win,
    signAndEditExecutable: true,
    signExecutable: true,
    signtoolOptions: {
      signingHashAlgorithms: ['sha256'],
      ...(thumbprint ? { certificateSha1: thumbprint } : {}),
    },
  },
};
