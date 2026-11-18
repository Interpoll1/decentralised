const required = ['FTP_HOST', 'FTP_USER', 'FTP_PASS', 'REMOTE_DIR'];
const missing = required.filter(name => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Deployment configuration missing: ${missing.join(', ')}. Configure the repository secrets/variables; no files were uploaded.`);
  process.exit(1);
}
if (!process.env.REMOTE_DIR.startsWith('/') || /[\r\n"\\]/.test(process.env.REMOTE_DIR)
  || /[\r\n"\\]/.test(process.env.FTP_HOST)) {
  throw new Error('Invalid deployment destination');
}
console.log('Deployment configuration present. Values are not logged.');
