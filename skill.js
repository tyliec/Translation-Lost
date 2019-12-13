/*
 *  ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 *  Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 *  ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 */

'use strict';

module.exports = {
    manifest: {
        publishingInformation: {
            isAvailableWorldwide: false,
            distributionCountries: ['US'],
            distributionMode: 'PUBLIC',
            category: 'GAMES',
            testingInstructions: 'Play the game!',
            locales: {
                'en-US': {
                    name: 'Lost in Translation',
                    invocation: 'Translation Lost',
                    summary: "A game where you try and understand Alexa's different accents",
                    description: `Have you taken a class from a foreign professor? Tried to talk to a co-worker who you just couldn't understand? Relive the memories with Lost in Translation!
                    
Lost in translation is a fun game where Alexa will say something in an accent, and it's up to you to decipher what she said!

She'll speak in accents such as French, Korean, and much more!

Some of the phrases are really hard, good luck!
                    `,
                    examplePhrases: [
                        'Alexa, launch Translation lost',
                        'Alexa, start Translation lost',
                        'Alexa, play Translation lost',
                    ],
                    keywords: [
                        'game',
                        'fun',
                        'single player',
                        'lost in translation',
                        'translate',
                        'accent',
                        'translation lost',
                        'english',
                        'language',
                        'foreign'
                    ]
                }
            }
        },
        privacyAndCompliance: {
            allowsPurchases: false,
            usesPersonalInfo: false,
            isChildDirected: false,
            isExportCompliant: true,
            containsAds: false,
            locales: {
                'en-US': {
                    privacyPolicyUrl: 'https://www.example.com/privacy.html',
                    termsOfUseUrl: 'https://www.example.com/terms.html'
                }
            }
        }
    }
};
