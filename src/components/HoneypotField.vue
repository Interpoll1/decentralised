<template>
  <!--
    Bot trap. Off-screen rather than display:none (many bots skip hidden
    inputs), removed from the tab order and the accessibility tree, and given
    a meaningless name so browser autofill never touches it.
  -->
  <div class="hp-field" aria-hidden="true">
    <label>
      Leave this empty
      <input
        type="text"
        name="ip_extra_ref"
        tabindex="-1"
        autocomplete="off"
        :value="modelValue"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
defineProps<{ modelValue: string }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<style scoped>
.hp-field {
  position: absolute;
  left: -10000px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
</style>
