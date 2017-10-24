module Main exposing (..)

import Html exposing (..)
import Http
import Util exposing ((=>))
import Json.Decode as Decode exposing (Decoder)
import Csv


-- APP


main : Program Never Model Msg
main =
    Html.program
        { init = init
        , view = view
        , update = update
        , subscriptions = \_ -> Sub.none
        }



-- MODEL


type Model
    = Loading
    | Error String
    | Loaded Graph


type alias Graph =
    { headers : List String
    , records : List (List String)
    }


init : ( Model, Cmd Msg )
init =
    let
        request =
            Http.getString "static/dependency-graph.csv"
    in
        ( Loading, Http.send LoadCsv request )



-- UPDATE


type Msg
    = LoadCsv (Result Http.Error String)


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        LoadCsv result ->
            let
                newModel =
                    case result of
                        Ok data ->
                            Loaded (Csv.parse data)

                        Err message ->
                            Error (toString message)
            in
                newModel => Cmd.none



-- VIEW


view : Model -> Html Msg
view model =
    case model of
        Loading ->
            div []
                [ h1 [] [ text "Loading..." ] ]

        Error error ->
            div []
                [ h1 [] [ text "Sorry something went wrong :(" ]
                , pre [] [ text error ]
                ]

        Loaded graph ->
            div [] [ text (toString graph) ]
