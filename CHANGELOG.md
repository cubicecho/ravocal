## [1.3.1](https://github.com/cubicecho/ravocal/compare/v1.3.0...v1.3.1) (2026-11-18)

### Bug Fixes

* **auth:** give up on Facebook's profile after AUTH_DEFAULTS.providerTimeoutMs ([fbad51a](https://github.com/cubicecho/ravocal/commit/fbad51a428a57cad1f42f8d860142f6145de6fe2))
* **sso:** add the one-time token only to a redirect on the app's origin ([d35e25a](https://github.com/cubicecho/ravocal/commit/d35e25a6720e54fcaae4c64a08b45789abf18a4e))
* **sso:** follow no redirect while pairing ([b3693f2](https://github.com/cubicecho/ravocal/commit/b3693f2cffd9ee0a17ab9bb8e472b78eedd3c7be))
* **sso:** refuse a public http:// issuer in production ([687f659](https://github.com/cubicecho/ravocal/commit/687f659a5ecfe0e3ebc1a2691e775953c606196b))
* **sso:** throttle pairSso and unpairSso ([27fa939](https://github.com/cubicecho/ravocal/commit/27fa9396c6658dc6f49942f7704255f9603a09d0))

# [1.3.0](https://github.com/cubicecho/ravocal/compare/v1.2.0...v1.3.0) (2026-11-18)

### Features

* **app:** let free time run past midnight ([0b74ba4](https://github.com/cubicecho/ravocal/commit/0b74ba4bb4aa1eed502a200acace33cba0ccea1c))
* **app:** show ranking progress in an open vote ([6dc376b](https://github.com/cubicecho/ravocal/commit/6dc376b6f9c18a3be3d7d7dba3a9de79c8216a27))
* **server:** tell members how many have ranked a vote ([848a7c3](https://github.com/cubicecho/ravocal/commit/848a7c3399a4998d0068a649ecd16b2e3ae424ea))

# [1.2.0](https://github.com/cubicecho/ravocal/compare/v1.1.0...v1.2.0) (2026-11-18)

### Bug Fixes

* **server:** word the vote threshold refusal for people, not the API ([6a9d277](https://github.com/cubicecho/ravocal/commit/6a9d27747061dd89b72a77564769ba612ecd9b1f))

### Features

* **app:** add, edit and delete free time ([487d1f2](https://github.com/cubicecho/ravocal/commit/487d1f2824dc968913aa84819a13f625c2b315f5))
* **app:** edit your display name in Settings ([3031eee](https://github.com/cubicecho/ravocal/commit/3031eee7ddf6eaced8a40634af9cdc92308bcf77))
* **app:** free-time choices on the server's UTC half-hour grid ([fc06a0b](https://github.com/cubicecho/ravocal/commit/fc06a0b50b5a595fc078c8c2bf931bf25e00facc))
* **app:** group settings dialog ([8d17c51](https://github.com/cubicecho/ravocal/commit/8d17c51dffe19c80010973ab78c747481684e1b5))
* **app:** invite dialog ([959bf9e](https://github.com/cubicecho/ravocal/commit/959bf9e1eeadc5f4fbf7e558d16aa0cefb755c23))
* **app:** invite, free time, votes and settings on the group page ([664425a](https://github.com/cubicecho/ravocal/commit/664425a8b94fb8f4fbbefd9f5cb28066a6b80483))
* **app:** start, rank and close votes ([4b6d113](https://github.com/cubicecho/ravocal/commit/4b6d113c184f18ea8a32dfff9d35bcf3e7751174))

# [1.1.0](https://github.com/cubicecho/ravocal/compare/v1.0.0...v1.1.0) (2026-11-18)

### Features

* **app:** set sign-in up from a setup URL, and manage it in Settings ([f2c37b1](https://github.com/cubicecho/ravocal/commit/f2c37b15fccceb04640f19cd7274786c3d53540a))
* **db:** oidc_settings for a paired provider, and users.is_admin ([023808b](https://github.com/cubicecho/ravocal/commit/023808b9ecf67520d795b364aafedcc380b5fb54))
* **server:** pair an OIDC provider from a setup URL ([3c72375](https://github.com/cubicecho/ravocal/commit/3c7237543a8da1de63cf99f96d35938da5abb6e5))
* **server:** sign in with an OIDC provider set by OIDC_ISSUER ([0c9cbf3](https://github.com/cubicecho/ravocal/commit/0c9cbf3dc845e069f20c2f033f142c585140775b))
* **server:** the first account becomes the instance's admin ([bd98a01](https://github.com/cubicecho/ravocal/commit/bd98a01b3a92105eed37c771c930325a6eef45db))

# 1.0.0 (2026-11-18)

* feat!: sign in with better-auth sessions and magic links ([37c0145](https://github.com/cubicecho/ravocal/commit/37c014574d378151273744b09cea63f961ecefd0))

### Bug Fixes

* **app:** don't count a closed vote's free members against today's group ([069ee87](https://github.com/cubicecho/ravocal/commit/069ee8743890b7374d654579b9ce606c4a11f945))
* **app:** give the groups list a member count line of its own ([079bb81](https://github.com/cubicecho/ravocal/commit/079bb81ac2842afa2ce1b9634740faea735b6117))
* **app:** keep form failures handled and the groups list fresh ([fd4a9fe](https://github.com/cubicecho/ravocal/commit/fd4a9fed117e821b063ea4f3d875b3b15ed1784a))
* **app:** lay out the group page's sections and read its times ([475a297](https://github.com/cubicecho/ravocal/commit/475a297d7b2ffb1cbdc42df7ddc9f0ff6734d3f6))
* **app:** load Vite's client types ([4e68d34](https://github.com/cubicecho/ravocal/commit/4e68d342a27728f81ff0d071015b551b7a71bb25))
* **app:** make the magic link and invite links work for a signed-out reader ([2ab0f0e](https://github.com/cubicecho/ravocal/commit/2ab0f0e758a3a55acd0bb10c44d4e6ca59fbcb4e))
* **app:** reinstall cubeui radio-group for the 40px strip, and drop the touchTarget workaround ([cce637c](https://github.com/cubicecho/ravocal/commit/cce637c1a54b86db430bc7074ca983a9b5ecdd71)), closes [cubeui#540](https://github.com/cubeui/issues/540) [cubeui#541](https://github.com/cubeui/issues/541)
* **app:** title the sign-in throttle callout apart from its message ([15190c5](https://github.com/cubicecho/ravocal/commit/15190c5c2c6e8a74fe3f4b824d53604d2b377772))
* **db:** emit JavaScript from the build and stop tracking tsbuildinfo ([fb65147](https://github.com/cubicecho/ravocal/commit/fb651479b6d59d7f8b55c93cd3916606941d161d))
* **db:** hand drizzle the relations inside the schema ([33798aa](https://github.com/cubicecho/ravocal/commit/33798aa47003ce8508648b11841e8ed29e2bfab2))
* **db:** register the relations with the drizzle client ([a0b0ef3](https://github.com/cubicecho/ravocal/commit/a0b0ef36c260898d2213b2be71ed3aa36b9c2ebd))
* **db:** type the database handle and run migrations through the open driver ([39e58ec](https://github.com/cubicecho/ravocal/commit/39e58ec6568f5e9ebf771842980d2df8c0fb3a96))
* **server:** accept the Dates the DateTime scalar hands addTimeBlock ([87a77ee](https://github.com/cubicecho/ravocal/commit/87a77ee61b5b9f2470646cc86e86c7495cf3b1a1))
* **server:** compare the overlap threshold in integers ([b500fff](https://github.com/cubicecho/ravocal/commit/b500fffda6795cd1bea8c96581079e34e5a4e766))
* **server:** end an unproven account's ways in when its address is proven ([48f9596](https://github.com/cubicecho/ravocal/commit/48f95967a5118a136d01cc02292caf6b7d43f3ec))
* **server:** give the mail transport one type ([5e3d847](https://github.com/cubicecho/ravocal/commit/5e3d84709337da26d8dea017e2891932cba3c09c))
* **server:** link a Google sign-in only when Google checked the address ([9fcd197](https://github.com/cubicecho/ravocal/commit/9fcd1977dc3d3efca5c847d709fbb5db4bea2818))
* **server:** load member users before starting a vote ([27c4efe](https://github.com/cubicecho/ravocal/commit/27c4efedc807aa1fd3878ed8e672d2b4660791c3))
* **server:** load member users when starting a vote ([2024184](https://github.com/cubicecho/ravocal/commit/202418488858ab00bdb0c5929cae8c554e43e073))
* **server:** load members' users before emailing a vote start ([c702874](https://github.com/cubicecho/ravocal/commit/c702874d6ccf75d19461fefa03978c1d4ec47961))
* **server:** pass the owner to computeVoteSlots in forceStartVote ([f007bff](https://github.com/cubicecho/ravocal/commit/f007bff1f2f0bb1b881fcc93a51d85e907d6c34f))
* **server:** resolve a group's members, invites and vote from myGroups ([d9a97ff](https://github.com/cubicecho/ravocal/commit/d9a97ffdc4fa7d80c55c8c1083cdf3047e73e32f))
* **server:** resolve Vote.slots and Vote.myRankings ([407ecea](https://github.com/cubicecho/ravocal/commit/407eceaec6ca680ae1eab84164f2fbaa69cf63da))
* **server:** serve the app for deep links under express 4 ([1d5ebc8](https://github.com/cubicecho/ravocal/commit/1d5ebc81deaf7db5b7b48c0dddcab900ff2e50ea))
* **server:** stop apollo from our signal handler instead of its own ([b2850a7](https://github.com/cubicecho/ravocal/commit/b2850a70c10833b3f308e8def4d041c3c6d44fbc))
* **server:** use express 4 types to match the express 4 runtime ([3606806](https://github.com/cubicecho/ravocal/commit/36068060a0f5c51d8ce3d6c53209255dbe9046f0))

### Features

* **app:** build the pages from cubeui's shells and forms ([c8352c0](https://github.com/cubicecho/ravocal/commit/c8352c00671051b088e232cf7afe9ff103ac44f3))
* **app:** connect and disconnect sign-in providers in Settings ([4c740ac](https://github.com/cubicecho/ravocal/commit/4c740acb38c6cfc29b2b62e1080fffb0528bfd9b))
* **app:** continue with Google or Facebook from the login page ([3c23af1](https://github.com/cubicecho/ravocal/commit/3c23af1d0afa3b05cd962b83246c233a3f873326))
* **app:** read and write through the generated API, and let the owner remove members and cancel invites ([f39ba60](https://github.com/cubicecho/ravocal/commit/f39ba600e799d499d7d3f48262e9dc7724523418))
* **db:** make an invite's token when its row is made ([563de1c](https://github.com/cubicecho/ravocal/commit/563de1c83e63b5886d7203ff90c552daa438cb74))
* **db:** store each vote slot's ballot position, and allow one open vote per group ([a2bd082](https://github.com/cubicecho/ravocal/commit/a2bd0824f66f711b1cb6291c2702c633725e5abc))
* **server:** add TOO_MANY_REQUESTS and an in-process sign-in limiter ([91f86ec](https://github.com/cubicecho/ravocal/commit/91f86ec134a956ed802893a87dc2897b9adfe877))
* **server:** check configuration in core/preflight.ts before boot ([d768687](https://github.com/cubicecho/ravocal/commit/d768687059bdd34a040c87e99fa2550936c32486))
* **server:** parse input with zod 4 through parseOrThrow ([9577e3c](https://github.com/cubicecho/ravocal/commit/9577e3c9aee09ed2d17771f58ffce23b119f0b6b))
* **server:** read Google and Facebook clients from the environment ([1abfe6b](https://github.com/cubicecho/ravocal/commit/1abfe6b0886f36d8469eede5fdcc33f16f8d0f19))
* **server:** refuse documents past OPERATION_LIMIT_DEFAULTS.maxTokens ([8e0f897](https://github.com/cubicecho/ravocal/commit/8e0f897582d173ed9f58a8bc43a18b0997263c47))
* **server:** serve GraphQL with graphql-yoga on Express 5 ([2e0c275](https://github.com/cubicecho/ravocal/commit/2e0c275579c12b72d6f5896d8937914edae6ef07))
* **server:** serve the drizzle-graphql schema, shared by group membership ([529f4e1](https://github.com/cubicecho/ravocal/commit/529f4e1c9b33bb98757a40405eeff43fc4d9c687))
* **server:** sign in with Google and Facebook ([379891f](https://github.com/cubicecho/ravocal/commit/379891fb4c0604a7bcbfd35b2eb8b761d4214979))
* **server:** throw coded GraphQLErrors from core/errors.ts ([a00b801](https://github.com/cubicecho/ravocal/commit/a00b8014c56907ea7c32b9854859c88cf475186e))
* **server:** wait for postgres before migrating, and close it on shutdown ([32d6548](https://github.com/cubicecho/ravocal/commit/32d65489b1cca55b000085883e420b8afdea6359))
* sign in without a link under SECURE_LOCAL_NET ([bdca6d6](https://github.com/cubicecho/ravocal/commit/bdca6d66c4602b7d00f19d6bc98f759bd2ab70b2))

### Reverts

* **app:** leave cubeui's error-message helper as the registry ships it ([d3bd1d7](https://github.com/cubicecho/ravocal/commit/d3bd1d787a2a538b71e69d8ff318e3545aa31846))

### BREAKING CHANGES

* requestMagicLink and verifyMagicLink are gone, and so is
  AuthPayload. BETTER_AUTH_SECRET replaces JWT_SECRET, and SMTP_URL and
  SMTP_FROM replace SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and
  EMAIL_FROM. With no SMTP_URL no sign-in links are sent. Sign-in links
  now open /auth/verify, and old JWTs are refused as UNAUTHENTICATED.
