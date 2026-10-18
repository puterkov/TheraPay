import { mkdir, copyFile, cp, writeFile } from 'node:fs/promises';
await mkdir('dist', {recursive:true});
for(const name of ['index.html','styles.css','app.js','domain.js','onboarding.html','onboarding-config.js']) await copyFile(name,'dist/'+name);
await cp('onboarding','dist/onboarding',{recursive:true});
await mkdir('dist/onboarding/assets',{recursive:true});
await copyFile('apps-script/Code.gs','dist/onboarding/assets/clinic-core.gs');
await copyFile('distribution/ClinicBootstrap.gs','dist/onboarding/assets/ClinicBootstrap.gs');
if(process.env.GOOGLE_OAUTH_CLIENT_ID||process.env.REGISTRY_URL){await writeFile('dist/onboarding-config.js','export const onboardingConfig=Object.freeze('+JSON.stringify({googleClientId:process.env.GOOGLE_OAUTH_CLIENT_ID||'',registryUrl:process.env.REGISTRY_URL||''})+');\n');}
console.log('Pilot site ready in dist/');
