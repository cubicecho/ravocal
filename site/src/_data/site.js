// Everything the layout needs to say who this is.
export default {
  name: "ravocal",
  tagline: "Group scheduling with ranked-choice voting, on your own server.",
  description:
    "Ravocal is a self-hosted group scheduling app: members mark when they're free, the group ranks the times they share, and the winning slot is the meeting. One container plus Postgres.",
  url: "https://cubicecho.github.io/ravocal/",
  repo: "https://github.com/cubicecho/ravocal",
  org: "https://cubicecho.com",
  // Optional — the layout only renders the ones you set. Ravocal is not on npm;
  // the README's Quickstart pulls the published image from GHCR.
  npm: null,
  docker: "https://github.com/cubicecho/ravocal/pkgs/container/ravocal",
};
