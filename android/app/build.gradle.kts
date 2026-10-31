plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "pl.filbary.prywatka"
    compileSdk = 35

    defaultConfig {
        applicationId = "pl.filbary.prywatka"
        minSdk = 26
        targetSdk = 34
        versionCode = 4
        versionName = "0.4-test"
    }

    // Klucz testowy (debug) – jego odcisk SHA1 jest wpisany w ustawieniach aplikacji Spotify.
    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
    buildTypes {
        getByName("debug") { signingConfig = signingConfigs.getByName("debug") }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
