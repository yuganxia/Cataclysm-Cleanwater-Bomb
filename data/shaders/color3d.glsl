#ifndef COLOR3D_GLSL
#define COLOR3D_GLSL

float color3d_luminance( vec3 rgb )
{
    return dot( rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
}

vec3 color3d_srgb_to_linear( vec3 rgb )
{
    vec3 low = rgb / 12.92;
    vec3 high = pow( max( ( rgb + 0.055 ) / 1.055, vec3( 0.0 ) ), vec3( 2.4 ) );
    return mix( low, high, step( vec3( 0.04045 ), rgb ) );
}

vec3 color3d_linear_to_srgb( vec3 rgb )
{
    rgb = max( rgb, vec3( 0.0 ) );
    vec3 low = rgb * 12.92;
    vec3 high = 1.055 * pow( rgb, vec3( 1.0 / 2.4 ) ) - 0.055;
    return mix( low, high, step( vec3( 0.0031308 ), rgb ) );
}

// Stephen Hill's fit of ACES.  Keeping the input and output matrices here makes
// every post path share exactly the same highlight roll-off and color response.
vec3 color3d_aces( vec3 rgb )
{
    const mat3 aces_input = mat3(
        0.59719, 0.07600, 0.02840,
        0.35458, 0.90834, 0.13383,
        0.04823, 0.01566, 0.83777 );
    const mat3 aces_output = mat3(
         1.60475, -0.10208, -0.00327,
        -0.53108,  1.10813, -0.07276,
        -0.07367, -0.00605,  1.07602 );
    rgb = aces_input * rgb;
    vec3 a = rgb * ( rgb + 0.0245786 ) - 0.000090537;
    vec3 b = rgb * ( 0.983729 * rgb + 0.4329510 ) + 0.238081;
    return clamp( aces_output * ( a / b ), 0.0, 1.0 );
}

#endif
