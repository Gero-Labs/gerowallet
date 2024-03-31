export default {
    name: value => {
        return (/^[\p{L} ,.'-]+$/u).test(value) || 'Invalid Name'
    },
    minCharacters: (min, value) => {
        return value => value.length >= min || `Minimum of ${min} characters`
    },
    oneOrMoreNumbers: value => {
        return /\d/.test(value) || 'One or more numbers are required'
    },
    containCapital: value => {
        return /[A-Z]/.test(value) || 'Should contain one or more capital letters'
    },
    containLowerCase: value => {
        return /[a-z]/.test(value) || 'Should contain one or more lower case letters'
    },
    spaceNotAllowed: value => {
        return !(/\s/.test(value)) || 'Should not contain the \'space\' character'
    },
    containSpecialCharacter: value => {
        return /[`!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/.test(value) || 'Should contain one or more special characters'
    },
    maxCharacters: (max, value) => {
        return value => value.length <= max || `Max ${max} characters`
    },
    required: value => {
        return !!value || 'Field is required'
    },
}