<template>
  <div>
    <h2>Spending Password</h2>
    <p class="subtitle my-0">Please enter your current password to change your password.</p>

    <hr class="my-5">

    <div class="d-flex">
      <div class="col-6 pa-0">
        <p class="helper  my-0">Current password</p>
      </div>
      <div class="col-6 pa-0">
        <v-text-field
          :append-icon="currentPassword ? 'mdi-eye' : 'mdi-eye-off'"
          :type="currentPassword ? 'text' : 'password'"
          name="currentPassword"
          dense
          outlined
          v-model="currentPasswordValue"
          class="input-group--focused"
          @click:append="currentPassword = !currentPassword"
        ></v-text-field>
      </div>
    </div>

    <hr class="mt-0 mb-5">

    <div class="d-flex">
      <div class="col-6 pa-0">
        <p class="helper  my-0">New password</p>
      </div>
      <div class="col-6 pa-0">
        <v-text-field
          :append-icon="newPassword ? 'mdi-eye' : 'mdi-eye-off'"
          :type="newPassword ? 'text' : 'password'"
          name="newPassword"
          dense
          outlined
          hint="At least 8 characters"
          value="wqfasds"
          v-model="newPasswordValue"
          class="input-group--focused"
          @click:append="newPassword = !newPassword"
        ></v-text-field>
      </div>
    </div>

    <hr class="mt-0 mb-5">

    <div class="d-flex">
      <div class="col-6 pa-0">
        <p class="helper  my-0">Confirm new password</p>
      </div>
      <div class="col-6 pa-0">
        <v-text-field
          :append-icon="confirmPassword ? 'mdi-eye' : 'mdi-eye-off'"
          :type="confirmPassword ? 'text' : 'password'"
          name="newPassword"
          dense
          outlined
          v-model="confirmPasswordValue"
          class="input-group--focused"
          @click:append="confirmPassword = !confirmPassword"
        ></v-text-field>
      </div>
    </div>
    <hr class="mt-0 mb-5">
    <div class="d-flex justify-end ">
      <v-btn><span class="capitalize">Cancel</span></v-btn>
      <v-btn color="primary" class="ml-2"><span class="capitalize">Update Password</span></v-btn>
    </div>

  </div>
</template>

<script>
export default {
  data: () => ({
    currentPassword: null,
    confirmPassword: null,
    newPassword: null,
    currentPasswordValue: 'test',
    newPasswordValue: 'test',
    confirmPasswordValue: 'test',
  }),
};
</script>


<style scoped>
h2 {
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.75rem;
  color: #F5F5F6;
}

.subtitle {
  color: #94969C;

}

.helper {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.25rem;
  color: #CECFD2;
}

hr {
  opacity: 20%;
}

.capitalize {
  text-transform: capitalize !important;
}
</style>
