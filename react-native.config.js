module.exports = {
  project: {
    android: {
      // absolute-ish paths from repo root
      sourceDir: "apps/customer-app/android",
      manifestPath: "apps/customer-app/android/app/src/main/AndroidManifest.xml",
      packageName: "com.outstationguru.customer" // base id; flavors add .dev/.stage/.prod
    },
  },
  dependencies: {},
};
