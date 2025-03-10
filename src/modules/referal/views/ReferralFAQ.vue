<script setup lang="ts">
    type faq = {
        icon: string;
        content: {
            title: string;
            subtitle?: string;
            content?: string;
        };
    };
    const faqs: faq[] = [
        {
            icon: 'mdi-heart-outline',
            content: {
                title: 'How do I participate in the Referral Program?',
                subtitle: 'Go to the "Referral" page, copy your unique 8-character code, and share it with friends.'
            }
        },
        {
            icon: 'mdi-swap-horizontal',
            content: {
                title: 'What are the conditions to earn the $25 in $GERO tokens?',
                subtitle: 'Your friend must redeem your code and complete one of these actions:',
                content: '<ul><li>Spend at least 50 ADA in a swap.</li>\
                            <li>Stake at least 1,000 ADA in the GERO2 POOL for at least 1 epoch (5 days).</li></ul>'
            }
        },
        {
            icon: 'mdi-database-outline',
            content: {
                title: 'How does the multi-tier rewards system work?',
                subtitle: 'The more friends you refer, the higher your rewards:',
                content: '<ul><li>Tier 1 (1-5 referrals): $25 per referral.</li>\
                            <li>Tier 2 (6-10 referrals): $30 per referral.</li>\
                            <li>Tier 3 (11+ referrals): $35 per referral.</li></ul>'
            }
        },
        {
            icon: 'mdi-file-document-outline',
            content: {
                title: 'How can I track my referrals and leaderboard ranking?',
                subtitle: 'Check the "Referral" page to see your referrals, rewards, and leaderboard position.'
            }
        },
        {
            icon: 'mdi-credit-card-refresh',
            content: {
                title: 'Can I share my referral code publicly, and is there a referral limit?',
                subtitle: 'Yes, share your code anywhere. There\'s no limit to how many friends you can refer.'
            }
        },
        {
            icon: 'mdi-trophy-outline',
            content: {
                title: 'How do I claim my $GERO rewards?',
                subtitle: 'Once your friend completes the required action, a "Claim" button will appear next to their entry on your referrals list. Click it to receive your reward.'
            }
        }
    ];
</script>

<template>
    <div class="referral-faq">
        <h2 class="text-center ma-4">FAQ</h2>
        <v-list class="transparent">
            <v-list-item dense v-for="(faq, i) in faqs" :key="i">
                <v-card class="border-gradient-gero-white" style="margin: 1rem auto">
                    <v-avatar size="48">
                        <v-icon class="pa-4" x-large>{{ faq.icon }}</v-icon>
                    </v-avatar>
                </v-card>
                <v-list-item-title class="text-xl">{{ faq.content.title }}</v-list-item-title>
                <v-list-item-subtitle class="text-md" v-if="faq.content.subtitle">{{ faq.content.subtitle }}</v-list-item-subtitle>
                <v-list-item-content v-if="faq.content.content" v-html="faq.content.content"></v-list-item-content>
            </v-list-item>
        </v-list>
    </div>
</template>

<style lang="scss" scoped>
    .v-list{
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        .v-card{
            border: 2px solid;
            border-image-source: linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0) 100%);
        }
        .v-list-item__content{
            overflow: unset !important;
        }

        .v-list-item{
            flex: 1 1 30%;
            display: flex;
            flex-direction: column;
            align-items: flex-start;

            .text-xl{
                font-size: 20px;
                text-align: center;
                font-weight: 600;
                margin-bottom: 1rem;
                line-height: 30px;
                white-space: unset !important;
                overflow: unset !important;
            }

            .text-md{
                font-size: 16px;
                font-weight: 400;
                margin-bottom: 1rem;
                line-height: 20px;
                white-space: unset !important;
                overflow: unset !important;
            }
        }
    }
</style>