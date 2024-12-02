<template>
    <div class="text-center">
        <v-row>
            <v-btn-toggle class="rounded-xl">
                <v-btn class="rounded-xl" value="refer">Refer a Friend</v-btn>
                <v-btn class="rounded-xl" value="redeem">Redeem Code</v-btn>
            </v-btn-toggle>
        </v-row>
    </div>
</template>

<style lang="css" scoped>
    .v-btn{
        text-transform: unset;
        padding: 50px;
        box-shadow: none !important;
        background-color: var(--gero-dark);
    }
    .v-btn.v-btn--active{
        color: var(--gero-teal);
        border-color: var(--gero-teal);
    }
    .row{
        display: inline-block;
        margin: 0 auto;
        border-radius: 28px;
        background-color: #272727;
    }
</style>